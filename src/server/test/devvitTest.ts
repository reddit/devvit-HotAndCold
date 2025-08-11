import { RedisMemoryServer } from 'redis-memory-server';
import Redis from 'ioredis';
import { it as itCore, type TestContext } from 'vitest';

import { RedisAPIDefinition, RedisKeyScope, type Metadata } from '@devvit/protos';
import { Context, runWithContext } from '@devvit/server';
import { Header } from '@devvit/shared-types/Header.js';
import type { Config } from '@devvit/shared-types/Config.js';

const redisServer = new RedisMemoryServer();
const host = await redisServer.getHost();
const port = await redisServer.getPort();

const conn = new Redis({ host, port });

// Used by adapter to prefix keys for INSTALLATION scope.
const currentPrefixRef: { value: string } = { value: '' };

// Helpers
const makeKey = (key: string, scope?: RedisKeyScope | undefined): string => {
  if (scope === RedisKeyScope.GLOBAL) return key;
  const prefix = currentPrefixRef.value;
  return prefix ? `${prefix}:${key}` : key;
};

// Minimal helper to check the special header toggle used by RedisClient
const shouldThrowNil = (metadata?: Metadata): boolean => {
  const hdr = (metadata as unknown as Record<string, { values?: string[] }>)?.['throw-redis-nil'];
  return !!hdr?.values?.[0] && hdr.values[0].toLowerCase() === 'true';
};

type StringValue = { value: string };
type Int64Value = { value: number };
type DoubleValue = { value: number };
type Empty = Record<string, never>;
type RenameResponse = { result: string };
type ExistsResponse = { existingKeys: number };
type RedisValues = { values: (string | null)[] };
type RedisFieldValues = { fieldValues: Record<string, string> };
type KeysResponse = { keys: string[] };
type HScanResponse = { cursor: number; fieldValues: { field: string; value: string }[] };
type ZScanResponse = { cursor: number; members: { member: string; score: number }[] };
type ZRangeResponse = { members: { member: string; score: number }[] };
type HSetNXResponse = { success: number };

// One stable adapter instance; reads prefix from currentPrefixRef at call time.
const redisPluginAdapter = {
  // Simple KV
  async Get(
    req: { key: string; scope?: RedisKeyScope },
    metadata?: Metadata
  ): Promise<StringValue | null> {
    const v = await conn.get(makeKey(req.key, req.scope));
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return null;
    }
    return { value: v };
  },
  async GetBytes(
    req: { key: string; scope?: RedisKeyScope },
    metadata?: Metadata
  ): Promise<{ value: Uint8Array } | null> {
    const v = await conn.getBuffer(makeKey(req.key, req.scope));
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return null;
    }
    return { value: v };
  },
  async Set(req: {
    key: string;
    value: string;
    nx?: boolean;
    xx?: boolean;
    expiration?: number;
    scope?: RedisKeyScope;
  }): Promise<StringValue> {
    const k = makeKey(req.key, req.scope);
    // NX/XX semantics
    if (req.nx && req.xx) throw new Error('invalid Set: nx and xx cannot both be true');
    if (req.nx) {
      const res = await conn.set(k, req.value, 'EX', req.expiration ?? 1, 'NX');
      return { value: res ?? 'OK' };
    } else if (req.xx) {
      const res = await conn.set(k, req.value, 'EX', req.expiration ?? 1, 'XX');
      return { value: res ?? 'OK' };
    }
    if (req.expiration && req.expiration > 0) {
      await conn.set(k, req.value, 'EX', req.expiration);
      return { value: 'OK' };
    }
    await conn.set(k, req.value);
    return { value: 'OK' };
  },
  async Exists(req: { keys: string[]; scope?: RedisKeyScope }): Promise<ExistsResponse> {
    const count = await conn.exists(...req.keys.map((k) => makeKey(k, req.scope)));
    return { existingKeys: count };
  },
  async Del(req: { keys: string[]; scope?: RedisKeyScope }): Promise<Int64Value> {
    const n = await conn.del(...req.keys.map((k) => makeKey(k, req.scope)));
    return { value: n };
  },
  async Type(req: { key: string; scope?: RedisKeyScope }): Promise<StringValue> {
    const t = await conn.type(makeKey(req.key, req.scope));
    return { value: t };
  },
  async Rename(req: {
    key: string;
    newKey: string;
    scope?: RedisKeyScope;
  }): Promise<RenameResponse> {
    const res = await conn.rename(makeKey(req.key, req.scope), makeKey(req.newKey, req.scope));
    return { result: res };
  },

  // Numbers
  async IncrBy(req: { key: string; value: number; scope?: RedisKeyScope }): Promise<Int64Value> {
    const v = await conn.incrby(makeKey(req.key, req.scope), req.value);
    return { value: Number(v) };
  },

  // Expiration and ranges
  async Expire(req: { key: string; seconds: number; scope?: RedisKeyScope }): Promise<Empty> {
    await conn.expire(makeKey(req.key, req.scope), req.seconds);
    return {};
  },
  async ExpireTime(req: { key: string; scope?: RedisKeyScope }): Promise<Int64Value> {
    const v = await conn.expiretime(makeKey(req.key, req.scope));
    return { value: Number(v) };
  },
  async GetRange(req: {
    key: string;
    start: number;
    end: number;
    scope?: RedisKeyScope;
  }): Promise<StringValue> {
    const v = await conn.getrange(makeKey(req.key, req.scope), req.start, req.end);
    return { value: v };
  },
  async SetRange(req: {
    key: string;
    offset: number;
    value: string;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.setrange(makeKey(req.key, req.scope), req.offset, req.value);
    return { value: Number(v) };
  },
  async Strlen(req: { key: string; scope?: RedisKeyScope }): Promise<Int64Value> {
    const v = await conn.strlen(makeKey(req.key, req.scope));
    return { value: Number(v) };
  },

  // Hashes
  async HSet(req: {
    key: string;
    fv: { field: string; value: string }[];
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const map: Record<string, string> = {};
    for (const { field, value } of req.fv) map[field] = value;
    const v = await conn.hset(makeKey(req.key, req.scope), map);
    return { value: Number(v) };
  },
  async HGet(
    req: { key: string; field: string; scope?: RedisKeyScope },
    metadata?: Metadata
  ): Promise<StringValue | null> {
    const v = await conn.hget(makeKey(req.key, req.scope), req.field);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return null;
    }
    return { value: v };
  },
  async HMGet(req: { key: string; fields: string[]; scope?: RedisKeyScope }): Promise<RedisValues> {
    const vals = await conn.hmget(makeKey(req.key, req.scope), ...req.fields);
    return { values: vals.map((v) => (v === null ? null : v)) };
  },
  async HGetAll(req: { key: string; scope?: RedisKeyScope }): Promise<RedisFieldValues> {
    const v = await conn.hgetall(makeKey(req.key, req.scope));
    return { fieldValues: v };
  },
  async HDel(req: { key: string; fields: string[]; scope?: RedisKeyScope }): Promise<Int64Value> {
    const n = await conn.hdel(makeKey(req.key, req.scope), ...req.fields);
    return { value: Number(n) };
  },
  async HScan(req: {
    key: string;
    cursor: number;
    pattern?: string;
    count?: number;
    scope?: RedisKeyScope;
  }): Promise<HScanResponse> {
    const args: (string | number)[] = [makeKey(req.key, req.scope), req.cursor];
    if (req.pattern) args.push('MATCH', req.pattern);
    if (req.count) args.push('COUNT', req.count);
    const [cursor, elements] = (await (conn as any).hscan(...args)) as [string, string[]];
    const fieldValues: { field: string; value: string }[] = [];
    for (let i = 0; i < elements.length; i += 2) {
      fieldValues.push({ field: elements[i]!, value: elements[i + 1]! });
    }
    return { cursor: Number(cursor), fieldValues };
  },
  async HKeys(req: { key: string; scope?: RedisKeyScope }): Promise<KeysResponse> {
    const keys = await conn.hkeys(makeKey(req.key, req.scope));
    return { keys };
  },
  async HIncrBy(req: {
    key: string;
    field: string;
    value: number;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.hincrby(makeKey(req.key, req.scope), req.field, req.value);
    return { value: Number(v) };
  },
  async HLen(req: { key: string; scope?: RedisKeyScope }): Promise<Int64Value> {
    const v = await conn.hlen(makeKey(req.key, req.scope));
    return { value: Number(v) };
  },
  async HSetNX(req: {
    key: string;
    field: string;
    value: string;
    scope?: RedisKeyScope;
  }): Promise<HSetNXResponse> {
    const v = await conn.hsetnx(makeKey(req.key, req.scope), req.field, req.value);
    return { success: Number(v) };
  },

  // ZSets
  async ZAdd(req: {
    key: string;
    members: { member: string; score: number }[];
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const args = req.members.flatMap((m) => [m.score, m.member]);
    const v = await conn.zadd(makeKey(req.key, req.scope), ...args);
    return { value: Number(v) };
  },
  async ZCard(req: { key: string; scope?: RedisKeyScope }): Promise<Int64Value> {
    const v = await conn.zcard(makeKey(req.key, req.scope));
    return { value: Number(v) };
  },
  async ZIncrBy(req: {
    key: string;
    member: string;
    value: number;
    scope?: RedisKeyScope;
  }): Promise<DoubleValue> {
    const v = await conn.zincrby(makeKey(req.key, req.scope), req.value, req.member);
    return { value: Number(v) };
  },
  async ZRange(req: {
    key: { key: string };
    start: string;
    stop: string;
    rev?: boolean;
    byLex?: boolean;
    byScore?: boolean;
    offset?: number;
    count?: number;
    scope?: RedisKeyScope;
  }): Promise<ZRangeResponse> {
    const k = makeKey(req.key.key, req.scope);
    let vals: string[] = [];
    if (req.byScore) {
      if (req.rev) {
        vals =
          req.offset != null
            ? await conn.zrevrangebyscore(
                k,
                req.stop,
                req.start,
                'WITHSCORES',
                'LIMIT',
                req.offset,
                req.count ?? 0
              )
            : await conn.zrevrangebyscore(k, req.stop, req.start, 'WITHSCORES');
      } else {
        vals =
          req.offset != null
            ? await conn.zrangebyscore(
                k,
                req.start,
                req.stop,
                'WITHSCORES',
                'LIMIT',
                req.offset,
                req.count ?? 0
              )
            : await conn.zrangebyscore(k, req.start, req.stop, 'WITHSCORES');
      }
    } else if (req.byLex) {
      if (req.rev) {
        vals =
          req.offset != null
            ? await conn.zrevrangebylex(k, req.start, req.stop, 'LIMIT', req.offset, req.count ?? 0)
            : await conn.zrevrangebylex(k, req.start, req.stop);
      } else {
        vals =
          req.offset != null
            ? await conn.zrangebylex(k, req.start, req.stop, 'LIMIT', req.offset, req.count ?? 0)
            : await conn.zrangebylex(k, req.start, req.stop);
      }
    } else {
      // For rank-based ranges, Redis does NOT support LIMIT.
      // If offset/count are provided, translate them into start/stop indices.
      const startIndex = Number(req.start);
      const stopIndex = Number(req.stop);
      let rankStart = startIndex;
      let rankStop = stopIndex;
      if (req.offset != null || req.count != null) {
        const offsetVal = Number(req.offset ?? 0);
        const countVal = req.count != null ? Number(req.count) : undefined;
        rankStart = startIndex + offsetVal;
        if (countVal != null) {
          rankStop = rankStart + Math.max(0, countVal) - 1;
        }
      }
      if (req.rev) {
        vals = await conn.zrevrange(k, rankStart, rankStop, 'WITHSCORES');
      } else {
        vals = await conn.zrange(k, rankStart, rankStop, 'WITHSCORES');
      }
    }
    const members: { member: string; score: number }[] = [];
    for (let i = 0; i < vals.length; i += 2) {
      members.push({ member: vals[i]!, score: Number(vals[i + 1]) });
    }
    return { members };
  },
  async ZRank(
    req: { key: { key: string }; member: string; scope?: RedisKeyScope },
    metadata?: Metadata
  ): Promise<Int64Value | null> {
    const v = await conn.zrank(makeKey(req.key.key, req.scope), req.member);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return null;
    }
    return { value: Number(v) };
  },
  async ZRem(req: {
    key: { key: string };
    members: string[];
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.zrem(makeKey(req.key.key, req.scope), ...req.members);
    return { value: Number(v) };
  },
  async ZRemRangeByLex(req: {
    key: { key: string };
    min: string;
    max: string;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.zremrangebylex(makeKey(req.key.key, req.scope), req.min, req.max);
    return { value: Number(v) };
  },
  async ZRemRangeByRank(req: {
    key: { key: string };
    start: number;
    stop: number;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.zremrangebyrank(makeKey(req.key.key, req.scope), req.start, req.stop);
    return { value: Number(v) };
  },
  async ZRemRangeByScore(req: {
    key: { key: string };
    min: number;
    max: number;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.zremrangebyscore(makeKey(req.key.key, req.scope), req.min, req.max);
    return { value: Number(v) };
  },
  async ZScan(req: {
    key: string;
    cursor: number;
    pattern?: string;
    count?: number;
    scope?: RedisKeyScope;
  }): Promise<ZScanResponse> {
    const args: (string | number)[] = [makeKey(req.key, req.scope), req.cursor];
    if (req.pattern) args.push('MATCH', req.pattern);
    if (req.count) args.push('COUNT', req.count);
    const [cursor, elements] = (await (conn as any).zscan(...args)) as [string, string[]];
    const members: { member: string; score: number }[] = [];
    for (let i = 0; i < elements.length; i += 2) {
      members.push({ member: elements[i + 1]!, score: Number(elements[i]) });
    }
    return { cursor: Number(cursor), members };
  },
  async ZScore(
    req: { key: { key: string }; member: string; scope?: RedisKeyScope },
    metadata?: Metadata
  ): Promise<DoubleValue | null> {
    const v = await conn.zscore(makeKey(req.key.key, req.scope), req.member);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return null;
    }
    return { value: Number(v) };
  },

  // Batch
  async MGet(req: { keys: string[]; scope?: RedisKeyScope }): Promise<RedisValues> {
    const keys = req.keys.map((k) => makeKey(k, req.scope));
    const vals = await conn.mget(...keys);
    return { values: vals.map((v) => (v === null ? null : v)) };
  },
  async MSet(req: { kv: { key: string; value: string }[]; scope?: RedisKeyScope }): Promise<Empty> {
    const flat: string[] = [];
    for (const { key, value } of req.kv) {
      flat.push(makeKey(key, req.scope), value);
    }
    await (conn as any).mset(...flat);
    return {};
  },

  // Bitfield
  async Bitfield(req: {
    key: string;
    commands: any[];
    scope?: RedisKeyScope;
  }): Promise<{ results: number[] }> {
    const res = await (conn as any).bitfield(
      makeKey(req.key, req.scope),
      ...(req.commands as any[])
    );
    return { results: res as number[] };
  },

  // Transactions (basic stubs to satisfy client if used)
  async Watch(_req: { keys: string[]; scope?: RedisKeyScope }): Promise<{ id: string }> {
    // Not a real tx id, but stable enough for tests
    return { id: `tx:${Date.now()}:${Math.random()}` };
  },
  async Unwatch(_req: { id: string }): Promise<Empty> {
    return {};
  },
  async Multi(_req: { id: string }): Promise<Empty> {
    return {};
  },
  async Exec(_req: { id: string }): Promise<{ response: any[] }> {
    return { response: [] };
  },
  async Discard(_req: { id: string }): Promise<Empty> {
    return {};
  },
} as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

const makeConfig = (): Config => {
  return {
    assets: {},
    providedDefinitions: [],
    webviewAssets: {},

    export: () => ({}) as any,
    provides: () => {},
    addPermissions: () => {},

    use<T>(definition: { fullName: string }): T {
      if (definition.fullName === RedisAPIDefinition.fullName) {
        return redisPluginAdapter as unknown as T;
      }
      throw new Error(`Plugin not mocked: ${definition.fullName}`);
    },

    uses(definition: { fullName: string }): boolean {
      return definition.fullName === RedisAPIDefinition.fullName;
    },
  };
};

const installGlobalConfig = (config: Config): void => {
  (globalThis as any).devvit ??= {};
  (globalThis as any).devvit.config = config;
  (globalThis as any).devvit.compute ??= { platform: 'test' };
};

// Public API
async function resetRedis(): Promise<void> {
  await conn.flushall();
}

function generateRandomString(length: number): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBuffer = new Uint32Array(length);
  crypto.getRandomValues(randomBuffer);
  let result = '';
  for (let i = 0; i < length; i++)
    result += characters.charAt(randomBuffer[i]! % characters.length);
  return result;
}

type ItFn = {
  (
    name: string,
    fn: (ctx: TestContext & { config: Config; prefix: string }) => Promise<void> | void
  ): void;
  only: (
    name: string,
    fn: (ctx: TestContext & { config: Config; prefix: string }) => Promise<void> | void
  ) => void;
};

function itImpl(
  name: string,
  fn: (ctx: TestContext & { config: Config; prefix: string }) => Promise<void> | void
): void {
  itCore(name, async (vitestCtx) => {
    const prefix = generateRandomString(12);
    currentPrefixRef.value = prefix;

    const cfg = makeConfig();
    installGlobalConfig(cfg);

    // Minimal viable headers for BaseContext
    const headers = {
      [Header.Subreddit]: 't5_testsub', // required
      [Header.SubredditName]: 'testsub', // optional but useful
      [Header.App]: 'test-app', // optional
      [Header.Version]: '0.0.0-test', // optional
      [Header.User]: 't2_testuser', // optional
      [Header.AppUser]: 't2_testuser',
      [Header.AppViewerAuthToken]: 'test-token',
    };

    const reqCtx = Context(headers);
    await runWithContext(reqCtx, async () => {
      await fn(Object.assign(vitestCtx, { config: cfg, prefix }));
    });
  });
}

const it: ItFn = Object.assign(
  (name: string, fn: Parameters<typeof itImpl>[1]) => itImpl(name, fn),
  {
    only: (
      name: string,
      fn: (ctx: TestContext & { config: Config; prefix: string }) => Promise<void> | void
    ) => {
      itCore.only(name, async (vitestCtx) => {
        const prefix = generateRandomString(12);
        currentPrefixRef.value = prefix;

        const cfg = makeConfig();
        installGlobalConfig(cfg);

        const installed = (globalThis as any).devvit?.config;
        if (typeof installed?.use !== 'function') {
          throw new Error('Harness failed to install config: config.use is not a function');
        }

        const reqCtx = Context({});
        await runWithContext(reqCtx, async () => {
          await fn(Object.assign(vitestCtx, { config: cfg, prefix }));
        });
      });
    },
  }
) as unknown as ItFn;

async function shutdown(): Promise<void> {
  await conn.quit();
  await redisServer.stop();
}

export { conn, resetRedis, it, shutdown };
