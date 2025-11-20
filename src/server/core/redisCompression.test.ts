import { expect } from 'vitest';
import { it, resetRedis, conn } from '../test/devvitTest';
import { redisCompressed, REDIS_GZIP_PREFIX } from './redisCompression';

// Helper to generate a long string that compresses well
const longString = 'a'.repeat(1000);

it('writes compressed data for long strings', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:compress';
  const fullKey = `${prefix}:${key}`;

  await redisCompressed.set(key, longString);

  // Check raw value in redis using full key (prefix + key)
  const raw = await conn.get(fullKey);
  expect(raw).toBeDefined();
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  // Check reading it back works
  const readBack = await redisCompressed.get(key);
  expect(readBack).toBe(longString);
});

it('does not compress short strings if it adds overhead', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:short';
  const fullKey = `${prefix}:${key}`;
  const shortString = 'abc';

  await redisCompressed.set(key, shortString);

  // Check raw value in redis
  const raw = await conn.get(fullKey);
  expect(raw).toBe(shortString);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);

  // Check reading it back works
  const readBack = await redisCompressed.get(key);
  expect(readBack).toBe(shortString);
});

it('transparently decompresses data', async () => {
  await resetRedis();
  const key = 'test:decompress';

  await redisCompressed.set(key, longString);
  const val = await redisCompressed.get(key);
  expect(val).toBe(longString);
});

it('handles corruption gracefully', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:corrupt';
  const fullKey = `${prefix}:${key}`;
  const badData = REDIS_GZIP_PREFIX + 'not-base64-data';

  // Set corrupt data
  await conn.set(fullKey, badData);

  // Should return raw value if decompression fails
  const val = await redisCompressed.get(key);
  expect(val).toBe(badData);
});

it('respects set options (TTL)', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:set_options';
  const fullKey = `${prefix}:${key}`;
  const expirationDate = new Date(Date.now() + 60000); // 60 seconds from now

  await redisCompressed.set(key, longString, { expiration: expirationDate });

  const ttl = await conn.ttl(fullKey);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(60);
});

it('handles hash compression (hSet/hGet)', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:hash_compress';
  const field = 'field1';
  const fullKey = `${prefix}:${key}`;

  await redisCompressed.hSet(key, { [field]: longString });

  // Check raw value in redis
  const raw = await conn.hget(fullKey, field);
  expect(raw).toBeDefined();
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  // Check reading it back works
  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(longString);
});

it('does not compress short strings in hash', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:hash_short';
  const field = 'field1';
  const fullKey = `${prefix}:${key}`;
  const shortString = 'abc';

  await redisCompressed.hSet(key, { [field]: shortString });

  const raw = await conn.hget(fullKey, field);
  expect(raw).toBe(shortString);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);

  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(shortString);
});

it('handles hSetNX compression', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:hsetnx';
  const field = 'field1';
  const fullKey = `${prefix}:${key}`;

  await redisCompressed.hSetNX(key, field, longString);

  const raw = await conn.hget(fullKey, field);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(longString);
});

it('handles hGetAll decompression', async () => {
  await resetRedis();
  const key = 'test:hgetall';

  await redisCompressed.hSet(key, {
    f1: longString,
    f2: 'short',
  });

  const all = await redisCompressed.hGetAll(key);
  expect(all.f1).toBe(longString);
  expect(all.f2).toBe('short');
});

it('handles hMGet decompression', async () => {
  await resetRedis();
  const key = 'test:hmget';

  await redisCompressed.hSet(key, {
    f1: longString,
    f2: 'short',
  });

  const values = await redisCompressed.hMGet(key, ['f1', 'f2', 'missing']);
  expect(values[0]).toBe(longString);
  expect(values[1]).toBe('short');
  expect(values[2]).toBeNull();
});

it('does not attempt compression for very short strings', async ({ prefix }) => {
  await resetRedis();
  const key = 'test:no_compress_short';
  const fullKey = `${prefix}:${key}`;
  // A string shorter than MIN_COMPRESSION_LENGTH (80)
  const shortish = 'a'.repeat(70);

  await redisCompressed.set(key, shortish);

  const raw = await conn.get(fullKey);
  expect(raw).toBe(shortish);
  // It should NOT be prefixed because we skipped compression logic entirely
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);
});

it('handles mSet and mGet', async ({ prefix }) => {
  await resetRedis();
  const k1 = 'test:m1';
  const k2 = 'test:m2';
  const fk1 = `${prefix}:${k1}`;
  const fk2 = `${prefix}:${k2}`;

  await redisCompressed.mSet({
    [k1]: longString,
    [k2]: 'short',
  });

  // Check raw
  const r1 = await conn.get(fk1);
  expect(r1?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);
  const r2 = await conn.get(fk2);
  expect(r2).toBe('short');

  // Check mGet
  const [v1, v2] = await redisCompressed.mGet([k1, k2]);
  expect(v1).toBe(longString);
  expect(v2).toBe('short');
});

it('proxies non-overridden methods correctly (zAdd/zRank)', async () => {
  await resetRedis();
  const key = 'test:zset_proxy';

  // zAdd is not overridden, so it passes through to the target
  // This verifies the 'bind' fix is working, otherwise this would throw
  // "TypeError: Cannot read private member..."
  await redisCompressed.zAdd(key, { member: 'user1', score: 100 });

  // zRank is not overridden
  const rank = await redisCompressed.zRank(key, 'user1');
  expect(rank).toBe(0);
});
