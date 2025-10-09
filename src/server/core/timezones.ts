import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

/**
 * Maintain a sorted set of users per timezone label and a reverse mapping
 * of username -> current timezone. We key ZSETs by the timezone label so we
 * can iterate all users in a given timezone for notifications.
 */
export namespace Timezones {
  // ZSET key for a specific timezone label (e.g., "UTC+05:30")
  export const ZoneKey = (zone: string) => `tz:${zone}` as const;
  // HASH key for reverse lookup of a user's current timezone
  export const UserToZoneKey = () => `tz:userToZone` as const;

  // Schema for an IANA-like or UTC label timezone string
  // We accept any non-empty trimmed string to remain flexible
  const zTimezone = z.string().trim().min(1);

  /**
   * Add user to a timezone's ZSET and update reverse mapping.
   * Score is Date.now() so we can optionally iterate by recency.
   */
  export const setUserTimezone = fn(
    z.object({
      username: zodRedditUsername,
      timezone: zTimezone,
    }),
    async ({ username, timezone }) => {
      const prev = await redis.hGet(UserToZoneKey(), username);
      if (prev && prev !== timezone) {
        // Remove from previous zone set if moving zones
        await redis.zRem(ZoneKey(prev), [username]);
      }

      await redis.zAdd(ZoneKey(timezone), { member: username, score: Date.now() });
      await redis.hSet(UserToZoneKey(), { [username]: timezone });
    }
  );

  /**
   * Remove a user from their current timezone ZSET and clear reverse mapping.
   */
  export const clearUserTimezone = fn(
    z.object({ username: zodRedditUsername }),
    async ({ username }) => {
      const prev = await redis.hGet(UserToZoneKey(), username);
      if (prev) {
        await redis.zRem(ZoneKey(prev), [username]);
      }
      await redis.hDel(UserToZoneKey(), [username]);
    }
  );

  /**
   * Get the stored timezone label for a user, if any.
   */
  export const getUserTimezone = fn(
    z.object({ username: zodRedditUsername }),
    async ({ username }) => {
      const zone = await redis.hGet(UserToZoneKey(), username);
      return zone ?? null;
    }
  );

  /**
   * Scan users within a timezone via cursor. Returns next cursor and members.
   * No ordering guarantees beyond Redis ZSCAN semantics.
   */
  export const getUsersInTimezone = fn(
    z.object({
      timezone: zTimezone,
      cursor: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(1000).optional().default(200),
    }),
    async ({ timezone, cursor, limit }) => {
      const total = (await redis.zCard(ZoneKey(timezone))) ?? 0;
      if (total <= 0 || cursor >= total) return { cursor: 0, members: [] };

      const start = Math.max(0, cursor);
      const result = await redis.zRange(ZoneKey(timezone), 0, -1, {
        by: 'rank',
        reverse: true,
        offset: start,
        count: Math.max(1, limit),
      });

      const nextCursorRaw = start + result.length;
      const nextCursor = nextCursorRaw >= total ? 0 : nextCursorRaw;
      return { cursor: nextCursor, members: result };
    }
  );

  /**
   * Count users in a timezone.
   */
  export const totalUsersInTimezone = fn(
    z.object({ timezone: zTimezone }),
    async ({ timezone }) => {
      return await redis.zCard(ZoneKey(timezone));
    }
  );
}
