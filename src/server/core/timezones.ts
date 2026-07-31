import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';

export namespace Timezones {
  export const UserToIanaKey = () => `tzv2:userToIana` as const;

  const DEFAULT_IANA = 'America/New_York';
  const IANA_ALIAS = new Map([['UTC', 'Etc/UTC']]);

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
    return null;
  }

  function coerceTimezoneForStorage(value: string): string {
    return normalizeTimezoneInput(value) ?? DEFAULT_IANA;
  }

  function sanitizeStoredTimezone(value: string | null | undefined): string | null {
    if (!value) return null;
    return normalizeTimezoneInput(value);
  }

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
}
