import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace Timezones {
  // Keys (v1 legacy hash for offsets; v2 IANA hash)
  export const UserToZoneKey = () => `tz:userToZone` as const;
  export const UserToIanaKey = () => `tzv2:userToIana` as const;

  const DEFAULT_IANA = 'America/New_York';
  const IANA_ALIAS = new Map([['UTC', 'Etc/UTC']]);

  // Basic offset-label -> canonical IANA guess. Imperfect by design, covers major regions.
  const OFFSET_TO_IANA: Record<string, string> = {
    // North America
    'UTC-08:00': 'America/Los_Angeles',
    'UTC-07:00': 'America/Los_Angeles',
    'UTC-06:00': 'America/Denver',
    'UTC-05:00': 'America/Chicago',
    'UTC-04:00': 'America/New_York',

    // Europe
    'UTC+00:00': 'Etc/UTC',
    'UTC+01:00': 'Europe/Paris',
    'UTC+02:00': 'Europe/Paris',

    // Asia
    'UTC+05:30': 'Asia/Kolkata',
    'UTC+08:00': 'Asia/Shanghai',
    'UTC+09:00': 'Asia/Tokyo',

    // Australia / New Zealand
    'UTC+10:00': 'Australia/Sydney',
    'UTC+11:00': 'Australia/Sydney',
    'UTC+12:00': 'Pacific/Auckland',

    // Middle East / Russia (coarse)
    'UTC+03:00': 'Europe/Moscow',
    'UTC+04:00': 'Asia/Dubai',

    // South America (coarse)
    'UTC-03:00': 'America/Sao_Paulo',
  } as const;

  function mapOffsetLabelToIana(label: string): string | null {
    const key = label.trim();
    return OFFSET_TO_IANA[key] ?? null;
  }

  function isValidIanaZone(zone: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
      return true;
    } catch {
      return false;
    }
  }

  function normalizeTimezoneInput(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const alias = IANA_ALIAS.get(trimmed);
    if (alias) return alias;
    if (trimmed.includes('/')) {
      return isValidIanaZone(trimmed) ? trimmed : null;
    }
    if (/^UTC[+-]\d{2}:\d{2}$/.test(trimmed)) {
      return mapOffsetLabelToIana(trimmed);
    }
    return null;
  }

  function coerceTimezoneForStorage(value: string): string {
    return normalizeTimezoneInput(value) ?? DEFAULT_IANA;
  }

  function sanitizeStoredTimezone(value: string | null | undefined): string | null {
    if (!value) return null;
    return normalizeTimezoneInput(value);
  }

  // All non-migration APIs are IANA-only

  /** set IANA for user (IANA required) */
  export const setUserTimezone = fn(
    z.object({ username: zodRedditUsername, timezone: z.string().trim().min(1) }),
    async ({ username, timezone }) => {
      const iana = coerceTimezoneForStorage(timezone);
      await redis.hSet(UserToIanaKey(), { [username]: iana });
    }
  );

  /** explicit IANA setter (alias) */
  export const setTimezone = fn(
    z.object({ username: zodRedditUsername, iana: z.string().trim().min(1) }),
    async ({ username, iana }) => {
      const final = coerceTimezoneForStorage(iana);
      await redis.hSet(UserToIanaKey(), { [username]: final });
    }
  );

  /** v2 getter */
  export const getUserTimezone = fn(
    z.object({ username: zodRedditUsername }),
    async ({ username }) => {
      const iana = await redis.hGet(UserToIanaKey(), username);
      return sanitizeStoredTimezone(iana);
    }
  );

  /** Bulk v2 getter */
  export const getUserTimezones = fn(
    z.object({ usernames: z.array(zodRedditUsername) }),
    async ({ usernames }) => {
      if (usernames.length === 0) return {};
      const chunkSize = 5000;
      const result: Record<string, string | null> = {};
      const sanitizedByValue = new Map<string, string | null>();
      const startMs = Date.now();
      const totalChunks = Math.ceil(usernames.length / chunkSize);
      console.log('[Timezones] getUserTimezones start', {
        usernames: usernames.length,
        chunkSize,
        totalChunks,
      });

      const sanitizeCached = (value: string | null | undefined): string | null => {
        if (!value) return null;
        if (sanitizedByValue.has(value)) {
          return sanitizedByValue.get(value) ?? null;
        }
        const sanitized = sanitizeStoredTimezone(value);
        sanitizedByValue.set(value, sanitized);
        return sanitized;
      };

      let processed = 0;
      for (let i = 0; i < usernames.length; i += chunkSize) {
        const chunk = usernames.slice(i, i + chunkSize);
        const chunkIndex = Math.floor(i / chunkSize) + 1;
        const tChunkStart = Date.now();
        const ianas = await redis.hMGet(UserToIanaKey(), chunk);
        const hgetMs = Date.now() - tChunkStart;
        processed += chunk.length;
        if (
          chunkIndex === 1 ||
          chunkIndex === totalChunks ||
          chunkIndex % 5 === 0 ||
          hgetMs > 2000
        ) {
          console.log('[Timezones] getUserTimezones progress', {
            chunkIndex,
            totalChunks,
            chunkSize: chunk.length,
            processed,
            hgetMs,
            elapsedMs: Date.now() - startMs,
          });
        }
        chunk.forEach((u, idx) => {
          result[u] = sanitizeCached(ianas[idx] ?? null);
        });
      }
      console.log('[Timezones] getUserTimezones completed', {
        usernames: usernames.length,
        uniqueZones: sanitizedByValue.size,
        elapsedMs: Date.now() - startMs,
      });
      return result;
    }
  );

  /** clear IANA */
  export const clearUserTimezone = fn(
    z.object({ username: zodRedditUsername }),
    async ({ username }) => {
      await redis.hDel(UserToIanaKey(), [username]);
    }
  );

  /**
   * One-off migration: copy users from tz:userToZone (UTC±HH:MM labels)
   * to tzv2:userToIana (IANA strings). Unknown/ambiguous offsets are skipped.
   */
  export const migrateOffsetsToIana = fn(
    z.object({ batchSize: z.number().int().min(1).max(5000).default(500) }),
    async ({ batchSize }) => {
      const legacyHashKey = UserToZoneKey();
      const ianaHashKey = UserToIanaKey();
      let cursor = 0;
      let migrated = 0;
      let skipped = 0;
      do {
        console.log(
          `Migrating Timezones data from ${legacyHashKey} to ${ianaHashKey}, at cursor ${cursor}`
        );
        const { cursor: next, fieldValues } = await redis.hScan(
          legacyHashKey,
          cursor,
          undefined,
          batchSize
        );
        cursor = next;
        for (const { field: username, value: offsetLabel } of fieldValues) {
          const iana = mapOffsetLabelToIana(offsetLabel);
          if (!iana) {
            skipped++;
            continue;
          }
          await redis.hSet(ianaHashKey, { [username]: iana });
          migrated++;
        }
      } while (cursor !== 0);
      return { migrated, skipped } as const;
    }
  );
}
