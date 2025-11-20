import { redis } from '@devvit/web/server';
import { gzipSync, gunzipSync } from 'node:zlib';

export const REDIS_GZIP_PREFIX = '__gzip__:' as const;

// Skip compression for short strings to save CPU
// Gzip header (10) + footer (8) + base64 overhead (4/3) means
// strings under ~50-60 chars rarely compress well.
// We set a safe threshold where compression is unlikely to be beneficial.
const MIN_COMPRESSION_LENGTH = 80;

const compress = (value: string): string => {
  if (value.length < MIN_COMPRESSION_LENGTH) return value;

  try {
    const compressed = gzipSync(value);
    return `${REDIS_GZIP_PREFIX}${compressed.toString('base64')}`;
  } catch {
    return value;
  }
};

const decompress = (value: string): string => {
  if (!value.startsWith(REDIS_GZIP_PREFIX)) return value;
  try {
    const buffer = Buffer.from(value.slice(REDIS_GZIP_PREFIX.length), 'base64');
    return gunzipSync(buffer).toString('utf-8');
  } catch {
    return value;
  }
};

/**
 * Drop-in replacement for the standard Devvit `redis` client that transparently handles
 * compression and decompression of values.
 *
 * Usage:
 * Instead of:
 *   import { redis } from '@devvit/web/server';
 *
 * Use:
 *   import { redisCompressed as redis } from './core/redisCompression';
 *
 * It automatically:
 * - Compresses values on write (set, hSet, mSet, etc.) if it saves space
 * - Decompresses values on read (get, hGet, mGet, etc.)
 * - Migrates uncompressed data to compressed format on read (lazy migration)
 */
export const redisCompressed = new Proxy(redis, {
  get(target, prop, receiver) {
    if (prop === 'get') {
      return async (key: string) => {
        const val = await target.get(key);
        if (!val || typeof val !== 'string') return val;

        return val.startsWith(REDIS_GZIP_PREFIX) ? decompress(val) : val;
      };
    }

    if (prop === 'set') {
      return async (key: string, value: string, options?: any) => {
        const compressed = compress(value);
        // Only store compressed if it saves space
        const toStore = compressed.length < value.length ? compressed : value;
        return target.set(key, toStore, options);
      };
    }

    if (prop === 'hGet') {
      return async (key: string, field: string) => {
        const val = await target.hGet(key, field);
        if (!val || typeof val !== 'string') return val;

        return val.startsWith(REDIS_GZIP_PREFIX) ? decompress(val) : val;
      };
    }

    if (prop === 'hSet') {
      return async (key: string, fieldValues: Record<string, string>) => {
        const newFieldValues: Record<string, string> = {};
        for (const [field, value] of Object.entries(fieldValues)) {
          const compressed = compress(value);
          newFieldValues[field] = compressed.length < value.length ? compressed : value;
        }
        return target.hSet(key, newFieldValues);
      };
    }

    if (prop === 'hSetNX') {
      return async (key: string, field: string, value: string) => {
        const compressed = compress(value);
        const toStore = compressed.length < value.length ? compressed : value;
        return target.hSetNX(key, field, toStore);
      };
    }

    if (prop === 'hGetAll') {
      return async (key: string) => {
        const all = await target.hGetAll(key);
        if (!all) return all;
        const result: Record<string, string> = {};
        for (const [field, value] of Object.entries(all)) {
          result[field] = value.startsWith(REDIS_GZIP_PREFIX) ? decompress(value) : value;
        }
        return result;
      };
    }

    if (prop === 'hMGet') {
      return async (key: string, fields: string[]) => {
        const values = await target.hMGet(key, fields);
        return values.map((val) => {
          if (val && typeof val === 'string' && val.startsWith(REDIS_GZIP_PREFIX)) {
            return decompress(val);
          }
          return val;
        });
      };
    }

    if (prop === 'mGet') {
      return async (keys: string[]) => {
        const values = await target.mGet(keys);
        return values.map((val) => {
          if (val && val.startsWith(REDIS_GZIP_PREFIX)) {
            return decompress(val);
          }
          return val;
        });
      };
    }

    if (prop === 'mSet') {
      return async (keyValues: Record<string, string>) => {
        const newKeyValues: Record<string, string> = {};
        for (const [key, value] of Object.entries(keyValues)) {
          const compressed = compress(value);
          newKeyValues[key] = compressed.length < value.length ? compressed : value;
        }
        return target.mSet(newKeyValues);
      };
    }

    // Forward any other properties/methods to the original redis client.
    // Crucial: We must bind functions to the target because the Devvit redis client
    // uses private class members (internal slots). If we call them with 'this'
    // set to the Proxy (default behavior), it throws "TypeError: Cannot read private member...".
    const value = Reflect.get(target, prop, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
