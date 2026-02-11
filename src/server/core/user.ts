import { z } from 'zod';
import { fn } from '../../shared/fn';
import { AppError } from '../../shared/errors';
import { zodRedditUsername } from '../utils';
import { context, reddit } from '@devvit/web/server';
import { redisCompressed as redis } from './redisCompression';
import { randomUUID } from 'node:crypto';

export namespace User {
  export const Key = (id: string) => `user:${id}` as const;
  export const UsernameToIdKey = () => `user:usernameToId` as const;
  export const MaskedUserIdPrefix = 'mid_';
  export const UsernameToMaskedIdKey = () => `user:usernameToMaskedId` as const;
  export const MaskedToUsernameKey = () => `user:maskedIdToUsername` as const;
  export const isMaskedId = (id: string) => id.startsWith(MaskedUserIdPrefix);

  export const Info = z.object({
    id: z.string(),
    username: zodRedditUsername,
    snoovatar: z.url().optional(),
  });

  const CACHE_TTL_SECONDS = 5 * 24 * 60 * 60;
  export const CacheTtlSeconds = CACHE_TTL_SECONDS;

  type UserInfo = z.infer<typeof Info>;

  const createMaskedUserId = () => `${MaskedUserIdPrefix}${randomUUID()}`;

  export const getOrCreateMaskedId = fn(zodRedditUsername, async (username) => {
    const existing = await redis.hGet(UsernameToMaskedIdKey(), username);
    if (existing) {
      if (!isMaskedId(existing)) throw new AppError('Invalid masked user id mapping');
      await redis.hSet(MaskedToUsernameKey(), { [existing]: username });
      return existing;
    }

    const maskedId = createMaskedUserId();
    await redis.hSet(UsernameToMaskedIdKey(), { [username]: maskedId });
    await redis.hSet(MaskedToUsernameKey(), { [maskedId]: username });
    return maskedId;
  });

  export const getUsernameFromMaskedId = fn(z.string(), async (maskedId) => {
    if (!isMaskedId(maskedId)) throw new AppError('Expected masked user id');
    const username = await redis.hGet(MaskedToUsernameKey(), maskedId);
    if (!username) throw new AppError('Masked user id not found');
    return zodRedditUsername.parse(username);
  });

  export const getUserIdFromMaskedId = fn(z.string(), async (maskedId) => {
    const username = await getUsernameFromMaskedId(maskedId);
    const mappedId = await redis.hGet(UsernameToIdKey(), username);
    if (mappedId) return mappedId;

    // If username -> id cache is cold, hydrate it via existing user surface.
    const info = await getByUsername(username);
    return info.id;
  });

  export const getCurrentMaskedId = fn(z.void(), async () => {
    const current = await getCurrent();
    return await getOrCreateMaskedId(current.username);
  });

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
      await redis.hSet(UsernameToIdKey(), { [info.username]: id });
      await getOrCreateMaskedId(info.username);
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
    await redis.hSet(UsernameToIdKey(), { [info.username]: id });
    await getOrCreateMaskedId(info.username);
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
    await getOrCreateMaskedId(info.username);
    return info;
  });

  /**
   * Lookup user id by username. Checks cache first, then falls back to Reddit API.
   * Returns null if user cannot be found.
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

  export const getManyInfoByUsernames = fn(
    z.object({ usernames: z.array(zodRedditUsername) }),
    async ({ usernames }) => {
      if (usernames.length === 0) return {};

      const usernameToId = await lookupIdsByUsernames({ usernames });
      const keys: string[] = [];
      const orderedUsernames: string[] = [];

      for (const username of usernames) {
        const id = usernameToId[username];
        if (id) {
          keys.push(Key(id));
          orderedUsernames.push(username);
        }
      }

      if (keys.length === 0) return {};

      const result: Record<string, UserInfo> = {};
      const chunkSize = 100;

      for (let i = 0; i < keys.length; i += chunkSize) {
        const chunkKeys = keys.slice(i, i + chunkSize);
        const chunkUsernames = orderedUsernames.slice(i, i + chunkSize);
        const chunkValues = await redis.mGet(chunkKeys);

        chunkValues.forEach((val, idx) => {
          const username = chunkUsernames[idx];
          if (val && username) {
            try {
              const info = Info.parse(JSON.parse(val));
              result[username] = info;
            } catch {
              // ignore
            }
          }
        });
      }
      return result;
    }
  );

  /**
   * Bulk read user info from cache by user IDs (t2_*). This is cache-only and will not call Reddit.
   * Returns a map of userId -> UserInfo for entries present + parseable in cache.
   */
  export const getManyInfoByIds = async (ids: readonly string[]) => {
    if (ids.length === 0) return {};

    const result: Record<string, UserInfo> = {};
    const chunkSize = 500;

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkIds = ids.slice(i, i + chunkSize);
      const keys = chunkIds.map((id) => Key(id));
      const values = await redis.mGet(keys);

      const usernameToId: Record<string, string> = {};
      for (let j = 0; j < values.length; j++) {
        const raw = values[j];
        const id = chunkIds[j];
        if (!raw || !id) continue;
        try {
          const info = Info.parse(JSON.parse(raw));
          result[id] = info;
          usernameToId[info.username] = info.id;
        } catch {
          // ignore parse failures
        }
      }

      if (Object.keys(usernameToId).length > 0) {
        await redis.hSet(UsernameToIdKey(), usernameToId);
      }
    }

    return result;
  };

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
      await redis.hSet(UsernameToIdKey(), { [info.username]: context.userId });
      await getOrCreateMaskedId(info.username);
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
    await redis.hSet(UsernameToIdKey(), { [info.username]: info.id });
    await getOrCreateMaskedId(info.username);
    return info;
  });
}
