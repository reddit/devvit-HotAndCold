import { RedisMemoryServer } from 'redis-memory-server';
import Redis from 'ioredis';
import { it as itCore, type TestContext } from 'vitest';

import {
  RedisAPIDefinition,
  RedisKeyScope,
  RedisAPI,
  type Metadata,
  BitfieldRequest,
  BitfieldResponse,
  type KeyRequest,
  type KeysRequest,
  type SetRequest,
  type KeyRangeRequest,
  type SetRangeRequest,
  type HSetRequest,
  type HGetRequest,
  type HMGetRequest,
  type HDelRequest,
  type HScanRequest,
  type HSetNXRequest,
  type ZAddRequest,
  type ZRangeRequest,
  type ZRemRequest,
  type ZRemRangeByLexRequest,
  type ZRemRangeByRankRequest,
  type ZRemRangeByScoreRequest,
  type ZScoreRequest,
  type ZRankRequest,
  type ZIncrByRequest,
  type ZScanRequest,
  type ExpireRequest,
  type WatchRequest,
  type TransactionId,
  type TransactionResponses,
  type RenameRequest,
  type RenameResponse,
  type ExistsResponse,
  type RedisValues,
  type RedisFieldValues,
  type KeysResponse,
  type HScanResponse,
  type ZScanResponse,
  type ZMembers,
} from '@devvit/protos';
import type {
  StringValue,
  BytesValue,
  Int64Value,
  DoubleValue,
} from '@devvit/protos/types/google/protobuf/wrappers.js';
import type { Empty } from '@devvit/protos/types/google/protobuf/empty.js';
import { Context, runWithContext } from '@devvit/server';
import { Header } from '@devvit/shared-types/Header.js';
import type { Config } from '@devvit/shared-types/Config.js';
import { expect } from 'vitest';

export { expect };

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

class MockedRedisApi implements RedisAPI {
  // Simple Key-Value operations
  async Get(request: KeyRequest, metadata?: Metadata): Promise<StringValue> {
    const v = await conn.get(makeKey(request.key, request.scope));
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return { value: '' } as StringValue;
    }
    return { value: v } as StringValue;
  }

  async GetBytes(request: KeyRequest, metadata?: Metadata): Promise<BytesValue> {
    const v = await conn.getBuffer(makeKey(request.key, request.scope));
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return { value: new Uint8Array() } as BytesValue;
    }
    return { value: v } as BytesValue;
  }

  async Set(request: SetRequest): Promise<StringValue> {
    const k = makeKey(request.key, request.scope);
    if (request.nx && request.xx) throw new Error('invalid Set: nx and xx cannot both be true');
    if (request.nx) {
      const res = await conn.set(k, request.value, 'EX', request.expiration ?? 1, 'NX');
      return { value: res ?? 'OK' } as StringValue;
    }
    if (request.xx) {
      const res = await conn.set(k, request.value, 'EX', request.expiration ?? 1, 'XX');
      return { value: res ?? 'OK' } as StringValue;
    }
    if (request.expiration && request.expiration > 0) {
      await conn.set(k, request.value, 'EX', request.expiration);
      return { value: 'OK' } as StringValue;
    }
    await conn.set(k, request.value);
    return { value: 'OK' } as StringValue;
  }

  async Exists(request: KeysRequest): Promise<ExistsResponse> {
    const count = await conn.exists(...request.keys.map((k) => makeKey(k, request.scope)));
    return { existingKeys: count } as ExistsResponse;
  }

  async Del(request: KeysRequest): Promise<Int64Value> {
    const n = await conn.del(...request.keys.map((k) => makeKey(k, request.scope)));
    return { value: n } as Int64Value;
  }

  async Type(request: KeyRequest): Promise<StringValue> {
    const t = await conn.type(makeKey(request.key, request.scope));
    return { value: t } as StringValue;
  }

  async Rename(request: RenameRequest): Promise<RenameResponse> {
    const res = await conn.rename(
      makeKey(request.key, request.scope),
      makeKey(request.newKey, request.scope)
    );
    return { result: res } as RenameResponse;
  }

  // Number operations
  async IncrBy(
    request: ZIncrByRequest | { key: string; value: number; scope?: RedisKeyScope }
  ): Promise<Int64Value> {
    // The proto has a dedicated IncrByRequest; using a compatible shape here.
    const key = (request as any).key;
    const value = (request as any).value;
    const scope = (request as any).scope as RedisKeyScope | undefined;
    const v = await conn.incrby(makeKey(key, scope), value);
    return { value: Number(v) } as Int64Value;
  }

  // Redis Hash operations
  async HSet(request: HSetRequest): Promise<Int64Value> {
    const map: Record<string, string> = {};
    for (const { field, value } of request.fv) map[field] = value;
    const v = await conn.hset(makeKey(request.key, request.scope), map);
    return { value: Number(v) } as Int64Value;
  }

  async HGet(request: HGetRequest, metadata?: Metadata): Promise<StringValue> {
    const v = await conn.hget(makeKey(request.key, request.scope), request.field);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return { value: '' } as StringValue;
    }
    return { value: v } as StringValue;
  }

  async HMGet(request: HMGetRequest): Promise<RedisValues> {
    const vals = await conn.hmget(makeKey(request.key, request.scope), ...request.fields);
    return {
      values: vals.map((v) => (v === null ? '' : v)),
    } as unknown as RedisValues;
  }

  async HGetAll(request: KeyRequest): Promise<RedisFieldValues> {
    const v = await conn.hgetall(makeKey(request.key, request.scope));
    return { fieldValues: v } as RedisFieldValues;
  }

  async HDel(request: HDelRequest): Promise<Int64Value> {
    const n = await conn.hdel(makeKey(request.key, request.scope), ...request.fields);
    return { value: Number(n) } as Int64Value;
  }

  async HScan(request: HScanRequest): Promise<HScanResponse> {
    const args: (string | number)[] = [makeKey(request.key, request.scope), request.cursor];
    if (request.pattern) args.push('MATCH', request.pattern);
    if (request.count) args.push('COUNT', request.count);
    const [cursor, elements] = (await (conn as any).hscan(...args)) as [string, string[]];
    const fieldValues: { field: string; value: string }[] = [];
    for (let i = 0; i < elements.length; i += 2) {
      fieldValues.push({ field: elements[i]!, value: elements[i + 1]! });
    }
    return { cursor: Number(cursor), fieldValues } as HScanResponse;
  }

  async HKeys(request: KeyRequest): Promise<KeysResponse> {
    const keys = await conn.hkeys(makeKey(request.key, request.scope));
    return { keys } as KeysResponse;
  }

  async HIncrBy(request: {
    key: string;
    field: string;
    value: number;
    scope?: RedisKeyScope;
  }): Promise<Int64Value> {
    const v = await conn.hincrby(makeKey(request.key, request.scope), request.field, request.value);
    return { value: Number(v) } as Int64Value;
  }

  async HLen(request: KeyRequest): Promise<Int64Value> {
    const v = await conn.hlen(makeKey(request.key, request.scope));
    return { value: Number(v) } as Int64Value;
  }

  async HSetNX(request: HSetNXRequest): Promise<{ success: number }> {
    const v = await conn.hsetnx(makeKey(request.key, request.scope), request.field, request.value);
    return { success: Number(v) } as { success: number };
  }

  // Transactions (no-op stubs)
  async Multi(_request: TransactionId): Promise<Empty> {
    return {} as Empty;
  }
  async Exec(_request: TransactionId): Promise<TransactionResponses> {
    return { response: [] } as TransactionResponses;
  }
  async Discard(_request: TransactionId): Promise<Empty> {
    return {} as Empty;
  }
  async Watch(_request: WatchRequest): Promise<TransactionId> {
    return { id: `tx:${Date.now()}:${Math.random()}` } as TransactionId;
  }
  async Unwatch(_request: TransactionId): Promise<Empty> {
    return {} as Empty;
  }

  // String operations
  async GetRange(request: KeyRangeRequest): Promise<StringValue> {
    const v = await conn.getrange(makeKey(request.key, request.scope), request.start, request.end);
    return { value: v } as StringValue;
  }
  async SetRange(request: SetRangeRequest): Promise<Int64Value> {
    const v = await conn.setrange(
      makeKey(request.key, request.scope),
      request.offset,
      request.value
    );
    return { value: Number(v) } as Int64Value;
  }
  async Strlen(request: KeyRequest): Promise<Int64Value> {
    const v = await conn.strlen(makeKey(request.key, request.scope));
    return { value: Number(v) } as Int64Value;
  }

  // Batch Key-Value operations
  async MGet(request: KeysRequest): Promise<RedisValues> {
    const keys = request.keys.map((k) => makeKey(k, request.scope));
    const vals = await conn.mget(...keys);
    return {
      values: vals.map((v) => (v === null ? '' : v)),
    } as unknown as RedisValues;
  }
  async MSet(request: {
    kv: { key: string; value: string }[];
    scope?: RedisKeyScope;
  }): Promise<Empty> {
    const flat: string[] = [];
    for (const { key, value } of request.kv) {
      flat.push(makeKey(key, request.scope), value);
    }
    await (conn as any).mset(...flat);
    return {} as Empty;
  }

  // Key expiration
  async Expire(request: ExpireRequest): Promise<Empty> {
    await conn.expire(makeKey(request.key, request.scope), request.seconds);
    return {} as Empty;
  }
  async ExpireTime(request: KeyRequest): Promise<Int64Value> {
    const v = await conn.expiretime(makeKey(request.key, request.scope));
    return { value: Number(v) } as Int64Value;
  }

  // Sorted sets
  async ZAdd(request: ZAddRequest): Promise<Int64Value> {
    const args = request.members.flatMap((m) => [m.score, m.member]);
    const v = await conn.zadd(makeKey(request.key, request.scope), ...args);
    return { value: Number(v) } as Int64Value;
  }
  async ZCard(request: KeyRequest): Promise<Int64Value> {
    const v = await conn.zcard(makeKey(request.key, request.scope));
    return { value: Number(v) } as Int64Value;
  }
  async ZRange(request: ZRangeRequest): Promise<ZMembers> {
    const k = makeKey(request.key?.key ?? '', request.scope);
    let vals: string[] = [];
    if (request.byScore) {
      if (request.rev) {
        vals =
          request.offset != null
            ? await conn.zrevrangebyscore(
                k,
                request.stop,
                request.start,
                'WITHSCORES',
                'LIMIT',
                request.offset,
                request.count ?? 0
              )
            : await conn.zrevrangebyscore(k, request.stop, request.start, 'WITHSCORES');
      } else {
        vals =
          request.offset != null
            ? await conn.zrangebyscore(
                k,
                request.start,
                request.stop,
                'WITHSCORES',
                'LIMIT',
                request.offset,
                request.count ?? 0
              )
            : await conn.zrangebyscore(k, request.start, request.stop, 'WITHSCORES');
      }
    } else if (request.byLex) {
      if (request.rev) {
        vals =
          request.offset != null
            ? await conn.zrevrangebylex(
                k,
                request.start,
                request.stop,
                'LIMIT',
                request.offset,
                request.count ?? 0
              )
            : await conn.zrevrangebylex(k, request.start, request.stop);
      } else {
        vals =
          request.offset != null
            ? await conn.zrangebylex(
                k,
                request.start,
                request.stop,
                'LIMIT',
                request.offset,
                request.count ?? 0
              )
            : await conn.zrangebylex(k, request.start, request.stop);
      }
    } else {
      const startIndex = Number(request.start);
      const stopIndex = Number(request.stop);
      let rankStart = startIndex;
      let rankStop = stopIndex;
      if (request.offset != null || request.count != null) {
        const offsetVal = Number(request.offset ?? 0);
        const countVal = request.count != null ? Number(request.count) : undefined;
        rankStart = startIndex + offsetVal;
        if (countVal != null) {
          rankStop = rankStart + Math.max(0, countVal) - 1;
        }
      }
      if (request.rev) {
        vals = await conn.zrevrange(k, rankStart, rankStop, 'WITHSCORES');
      } else {
        vals = await conn.zrange(k, rankStart, rankStop, 'WITHSCORES');
      }
    }
    const members: { member: string; score: number }[] = [];
    for (let i = 0; i < vals.length; i += 2) {
      members.push({ member: vals[i]!, score: Number(vals[i + 1]) });
    }
    return { members } as ZMembers;
  }
  async ZRem(request: ZRemRequest): Promise<Int64Value> {
    const v = await conn.zrem(makeKey(request.key?.key ?? '', request.scope), ...request.members);
    return { value: Number(v) } as Int64Value;
  }
  async ZRemRangeByLex(request: ZRemRangeByLexRequest): Promise<Int64Value> {
    const v = await conn.zremrangebylex(
      makeKey(request.key?.key ?? '', request.scope),
      request.min,
      request.max
    );
    return { value: Number(v) } as Int64Value;
  }
  async ZRemRangeByRank(request: ZRemRangeByRankRequest): Promise<Int64Value> {
    const v = await conn.zremrangebyrank(
      makeKey(request.key?.key ?? '', request.scope),
      request.start,
      request.stop
    );
    return { value: Number(v) } as Int64Value;
  }
  async ZRemRangeByScore(request: ZRemRangeByScoreRequest): Promise<Int64Value> {
    const v = await conn.zremrangebyscore(
      makeKey(request.key?.key ?? '', request.scope),
      request.min,
      request.max
    );
    return { value: Number(v) } as Int64Value;
  }
  async ZScan(request: ZScanRequest): Promise<ZScanResponse> {
    const args: (string | number)[] = [makeKey(request.key, request.scope), request.cursor];
    if (request.pattern) args.push('MATCH', request.pattern);
    if (request.count) args.push('COUNT', request.count);
    const [cursor, elements] = (await (conn as any).zscan(...args)) as [string, string[]];
    const members: { member: string; score: number }[] = [];
    for (let i = 0; i < elements.length; i += 2) {
      // ioredis returns [member, score] pairs from zscan with WITHSCORES-like structure
      const member = elements[i]!;
      const score = Number(elements[i + 1]);
      members.push({ member, score });
    }
    return { cursor: Number(cursor), members } as ZScanResponse;
  }
  async ZScore(request: ZScoreRequest, metadata?: Metadata): Promise<DoubleValue> {
    const v = await conn.zscore(makeKey(request.key?.key ?? '', request.scope), request.member);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return { value: 0 } as DoubleValue;
    }
    return { value: Number(v) } as DoubleValue;
  }
  async ZRank(request: ZRankRequest, metadata?: Metadata): Promise<Int64Value> {
    const v = await conn.zrank(makeKey(request.key?.key ?? '', request.scope), request.member);
    if (v == null) {
      if (shouldThrowNil(metadata)) throw new Error('redis: nil');
      return { value: -1 } as Int64Value;
    }
    return { value: Number(v) } as Int64Value;
  }
  async ZIncrBy(request: ZIncrByRequest): Promise<DoubleValue> {
    const v = await conn.zincrby(
      makeKey(request.key, request.scope),
      request.value,
      request.member
    );
    return { value: Number(v) } as DoubleValue;
  }

  // Bitfield
  async Bitfield(request: BitfieldRequest): Promise<BitfieldResponse> {
    const flat: (string | number)[] = [];
    for (const cmd of request.commands ?? []) {
      if (cmd.set) {
        flat.push('SET', cmd.set.encoding, Number(cmd.set.offset), Number(cmd.set.value));
      } else if (cmd.get) {
        flat.push('GET', cmd.get.encoding, Number(cmd.get.offset));
      } else if (cmd.incrBy) {
        flat.push(
          'INCRBY',
          cmd.incrBy.encoding,
          Number(cmd.incrBy.offset),
          Number(cmd.incrBy.increment)
        );
      } else if (cmd.overflow) {
        const behavior = cmd.overflow.behavior;
        const mode = behavior === 1 ? 'WRAP' : behavior === 2 ? 'SAT' : 'FAIL';
        flat.push('OVERFLOW', mode);
      }
    }
    const res = await (conn as any).bitfield(makeKey(request.key, undefined), ...(flat as any[]));
    return { results: res as number[] } as BitfieldResponse;
  }
}

// Adapter removed in favor of strongly-typed class implementation above.

const makeConfig = (): Config => {
  return {
    assets: {},
    providedDefinitions: [],
    webviewAssets: {},
    getPermissions: () => [],

    export: () => ({}) as any,
    provides: () => {},
    addPermissions: () => {},

    use<T>(definition: { fullName: string }): T {
      if (definition.fullName === RedisAPIDefinition.fullName) {
        return new MockedRedisApi() as unknown as T;
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

function itImpl(
  name: string,
  fn: (ctx: TestContext & { config: Config; prefix: string }) => Promise<void> | void
): void {
  itCore(name, async (vitestCtx) => {
    const prefix = generateRandomString(12);
    currentPrefixRef.value = prefix;

    const cfg = makeConfig();
    installGlobalConfig(cfg);

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

        const reqCtx = Context(headers);
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
