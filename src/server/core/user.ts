import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { AppError } from '../../shared/errors';
import { zodRedditUsername } from '../utils';
import { context, reddit } from '@devvit/web/server';

export namespace User {
  export const Key = (id: string) => `user:${id}` as const;
  const UsernameKey = (username: string) => `user:username:${username.toLowerCase()}` as const;

  const cacheUserInfo = async (info: z.infer<typeof Info>) => {
    const payload = JSON.stringify(info);
    await Promise.all([
      redis.set(Key(info.id), payload),
      redis.set(UsernameKey(info.username), payload),
    ]);
  };

  export const Info = z.object({
    id: z.string(),
    username: zodRedditUsername,
    snoovatar: z.url().optional(),
  });

  /**
   * Gets current user from cache or reads from Reddit and caches the result
   */
  export const getCurrent = fn(z.void(), async () => {
    if (!context.userId) throw new AppError('User not found');

    const cached = await redis.get(Key(context.userId));
    if (cached) {
      const info = Info.parse(JSON.parse(cached));
      await redis.set(UsernameKey(info.username), cached);
      return info;
    }

    const user = await reddit.getCurrentUser();
    if (!user) throw new AppError('User not found');
    const snoovatar = await user.getSnoovatarUrl();

    const info = Info.parse({
      id: user.id,
      username: user.username,
      snoovatar,
    });

    await cacheUserInfo(info);
    return info;
  });

  /**
   * Get user by id from cache or reads from Reddit and caches the result
   */
  export const getById = fn(z.string(), async (id) => {
    const cached = await redis.get(Key(id));
    if (cached) {
      const info = Info.parse(JSON.parse(cached));
      await redis.set(UsernameKey(info.username), cached);
      return info;
    }

    const user = await reddit.getUserById(id as any);
    if (!user) throw new AppError('User not found');
    const snoovatar = await user.getSnoovatarUrl();

    const info = Info.parse({
      id: user.id,
      username: user.username,
      snoovatar,
    });

    await cacheUserInfo(info);
    return info;
  });

  export const getCachedByUsername = fn(zodRedditUsername, async (username) => {
    const cached = await redis.get(UsernameKey(username));
    if (!cached) return null;
    return Info.parse(JSON.parse(cached));
  });
}
