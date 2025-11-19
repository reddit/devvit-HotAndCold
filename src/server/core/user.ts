import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { AppError } from '../../shared/errors';
import { zodRedditUsername } from '../utils';
import { context, reddit } from '@devvit/web/server';

export namespace User {
  export const Key = (id: string) => `user:${id}` as const;
  export const UsernameToIdKey = () => `user:usernameToId` as const;
  export const IdToUsernameKey = () => `user:idToUsername` as const;

  export const Info = z.object({
    id: z.string(),
    username: zodRedditUsername,
    snoovatar: z.url().optional(),
  });

  const CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;
  export const CacheTtlSeconds = CACHE_TTL_SECONDS;

  type UserInfo = z.infer<typeof Info>;

  const cacheUserInfo = async (info: UserInfo) => {
    await redis.set(Key(info.id), JSON.stringify(info));
    await redis.expire(Key(info.id), CacheTtlSeconds);
  };

  const persistUserCacheById = async (id: string) => {
    const key = Key(id);
    const raw = await redis.get(key);
    if (raw == null) return false;
    await redis.set(key, raw);
    return true;
  };

  const reapplyUserCacheExpiryById = async (id: string) => {
    const key = Key(id);
    const exists = await redis.exists(key);
    if (!exists) return false;
    await redis.expire(key, CacheTtlSeconds);
    return true;
  };

  /**
   * Get user by id from cache or reads from Reddit and caches the result
   */
  export const getById = fn(z.string(), async (id) => {
    const cached = await redis.get(Key(id));
    if (cached) {
      const info = Info.parse(JSON.parse(cached));
      await redis.hSet(IdToUsernameKey(), { [id]: info.username });
      await redis.hSet(UsernameToIdKey(), { [info.username]: id });
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
    await redis.hSet(IdToUsernameKey(), { [id]: info.username });
    await redis.hSet(UsernameToIdKey(), { [info.username]: id });
    return info;
  });

  /**
   * Get user by username, preferring Redis caches over Reddit API.
   */
  export const getByUsername = fn(zodRedditUsername, async (username) => {
    // Try mapping cache first
    const mappedId = await redis.hGet(UsernameToIdKey(), username);
    if (mappedId) {
      const cached = await redis.get(Key(mappedId));
      if (cached) {
        const info = Info.parse(JSON.parse(cached));
        await redis.hSet(IdToUsernameKey(), { [mappedId]: info.username });
        return info;
      }
    }

    // Fallback to Reddit API
    const user = await reddit.getUserByUsername(username);
    if (!user) throw new AppError('User not found');
    const snoovatar = await user.getSnoovatarUrl();

    const info = Info.parse({
      id: user.id,
      username: user.username,
      snoovatar,
    });

    await cacheUserInfo(info);
    await redis.hSet(UsernameToIdKey(), { [info.username]: info.id });
    await redis.hSet(IdToUsernameKey(), { [info.id]: info.username });
    return info;
  });

  /**
   * Lookup user id by username using cache only (no Reddit API).
   * Returns null if mapping is missing.
   */
  export const lookupIdByUsername = fn(zodRedditUsername, async (username) => {
    const id = await redis.hGet(UsernameToIdKey(), username);
    if (id) return id;
    // Hydrate on miss via User surface (which also populates caches)
    try {
      const info = await User.getByUsername(username);
      return info?.id ?? null;
    } catch {
      return null;
    }
  });

  export const lookupIdsByUsernames = fn(
    z.object({ usernames: z.array(zodRedditUsername) }),
    async ({ usernames }) => {
      if (usernames.length === 0) return {};
      // Chunk to avoid hitting command size limits
      const chunkSize = 5000;
      const result: Record<string, string | null> = {};

      for (let i = 0; i < usernames.length; i += chunkSize) {
        const chunk = usernames.slice(i, i + chunkSize);
        const ids = await redis.hMGet(UsernameToIdKey(), chunk);
        chunk.forEach((u, idx) => {
          result[u] = ids[idx] ?? null;
        });
      }
      return result;
    }
  );

  export const persistCacheForUsername = fn(zodRedditUsername, async (username) => {
    const info = await getByUsername(username);
    await persistUserCacheById(info.id);
    return info;
  });

  export const reapplyCacheExpiryForUsername = fn(zodRedditUsername, async (username) => {
    const id = await lookupIdByUsername(username);
    if (!id) return false;
    return reapplyUserCacheExpiryById(id);
  });

  /**
   * Gets current user from cache or Reddit and updates mapping caches.
   */
  export const getCurrent = fn(z.void(), async () => {
    if (!context.userId) throw new AppError('User not found');

    const cached = await redis.get(Key(context.userId));
    if (cached) {
      const info = Info.parse(JSON.parse(cached));
      await redis.hSet(IdToUsernameKey(), { [context.userId]: info.username });
      await redis.hSet(UsernameToIdKey(), { [info.username]: context.userId });
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
    await redis.hSet(IdToUsernameKey(), { [info.id]: info.username });
    await redis.hSet(UsernameToIdKey(), { [info.username]: info.id });
    return info;
  });
}
