import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { AppError } from '../../shared/errors';
import { zodRedditUsername } from '../utils';
import { context, reddit } from '@devvit/web/server';

export namespace User {
  export const Key = (id: string) => `user:${id}` as const;

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

    const user = await redis.get(Key(context.userId));
    if (!user) {
      const user = await reddit.getCurrentUser();
      if (!user) throw new AppError('User not found');
      const snoovatar = await user.getSnoovatarUrl();

      const info = Info.parse({
        id: user.id,
        username: user.username,
        snoovatar,
      });

      await redis.set(Key(context.userId), JSON.stringify(info));
      return info;
    }
    return Info.parse(JSON.parse(user));
  });

  /**
   * Get user by id from cache or reads from Reddit and caches the result
   */
  export const getById = fn(z.string(), async (id) => {
    const user = await redis.get(Key(id));
    if (!user) {
      const user = await reddit.getUserById(id);
      if (!user) throw new AppError('User not found');
      const snoovatar = await user.getSnoovatarUrl();

      const info = Info.parse({
        id: user.id,
        username: user.username,
        snoovatar,
      });

      await redis.set(Key(id), JSON.stringify(info));
      return info;
    }
    return Info.parse(JSON.parse(user));
  });
}
