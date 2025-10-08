import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis, reddit, context } from '@devvit/web/server';

const adminFlagKey = (userId: string) => `admin:${userId}`;

export namespace Admin {
  /**
   * Gets cached admin status for a user
   */
  export const getCachedIsAdmin = fn(z.string(), async (userId: string) => {
    const key = adminFlagKey(userId);
    const value = await redis.get(key);
    if (value === undefined || value === null) return null;
    return value === '1';
  });

  /**
   * Sets cached admin status for a user with 30 day expiration
   */
  export const setCachedIsAdmin = fn(
    z.object({
      userId: z.string(),
      isAdmin: z.boolean(),
    }),
    async ({ userId, isAdmin }) => {
      const key = adminFlagKey(userId);
      await redis.set(key, isAdmin ? '1' : '0');
      await redis.expire(key, 30 * 24 * 60 * 60); // 30 days
    }
  );

  /**
   * Returns whether the current user is an admin. Caches result in Redis.
   */
  export const isAdmin = fn(z.void(), async () => {
    const { userId } = context;
    if (!userId) {
      return false;
    }

    // Check cache first
    const cached = await getCachedIsAdmin(userId);
    if (cached !== null) {
      return cached;
    }

    // Fetch from Reddit API and cache
    try {
      const user = await reddit.getUserById(userId);
      if (!user) return false;
      const isAdmin = user.isAdmin;
      await setCachedIsAdmin({ userId, isAdmin });
      return isAdmin;
    } catch (err) {
      // On error, do not cache a false negative; just return false
      return false;
    }
  });
}
