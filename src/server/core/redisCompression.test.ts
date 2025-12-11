import { expect } from 'vitest';
import { test } from '../test';
import { redisCompressed, REDIS_GZIP_PREFIX } from './redisCompression';
import { redis } from '@devvit/web/server';

// Helper to generate a long string that compresses well
const longString = 'a'.repeat(1000);

test('writes compressed data for long strings', async () => {
  const key = 'test:compress';

  await redisCompressed.set(key, longString);

  // Check raw value in redis using full key (prefix + key)
  const raw = await redis.get(key);
  expect(raw).toBeDefined();
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  // Check reading it back works
  const readBack = await redisCompressed.get(key);
  expect(readBack).toBe(longString);
});

test('does not compress short strings if it adds overhead', async () => {
  const key = 'test:short';
  const shortString = 'abc';

  await redisCompressed.set(key, shortString);

  // Check raw value in redis
  const raw = await redis.get(key);
  expect(raw).toBe(shortString);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);

  // Check reading it back works
  const readBack = await redisCompressed.get(key);
  expect(readBack).toBe(shortString);
});

test('transparently decompresses data', async () => {
  const key = 'test:decompress';

  await redisCompressed.set(key, longString);
  const val = await redisCompressed.get(key);
  expect(val).toBe(longString);
});

test('handles corruption gracefully', async () => {
  const key = 'test:corrupt';
  const badData = REDIS_GZIP_PREFIX + 'not-base64-data';

  // Set corrupt data
  await redis.set(key, badData);

  // Should return raw value if decompression fails
  const val = await redisCompressed.get(key);
  expect(val).toBe(badData);
});

test('handles hash compression (hSet/hGet)', async () => {
  const key = 'test:hash_compress';
  const field = 'field1';

  await redisCompressed.hSet(key, { [field]: longString });

  // Check raw value in redis
  const raw = await redis.hGet(key, field);
  expect(raw).toBeDefined();
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  // Check reading it back works
  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(longString);
});

test('does not compress short strings in hash', async () => {
  const key = 'test:hash_short';
  const field = 'field1';
  const shortString = 'abc';

  await redisCompressed.hSet(key, { [field]: shortString });

  const raw = await redis.hGet(key, field);
  expect(raw).toBe(shortString);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);

  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(shortString);
});

test('handles hSetNX compression', async () => {
  const key = 'test:hsetnx';
  const field = 'field1';

  await redisCompressed.hSetNX(key, field, longString);

  const raw = await redis.hGet(key, field);
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);

  const readBack = await redisCompressed.hGet(key, field);
  expect(readBack).toBe(longString);
});

test('handles hGetAll decompression', async () => {
  const key = 'test:hgetall';

  await redisCompressed.hSet(key, {
    f1: longString,
    f2: 'short',
  });

  const all = await redisCompressed.hGetAll(key);
  expect(all.f1).toBe(longString);
  expect(all.f2).toBe('short');
});

test('handles hMGet decompression', async () => {
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

test('does not attempt compression for very short strings', async () => {
  const key = 'test:no_compress_short';
  // A string shorter than MIN_COMPRESSION_LENGTH (80)
  const shortish = 'a'.repeat(70);

  await redisCompressed.set(key, shortish);

  const raw = await redis.get(key);
  expect(raw).toBe(shortish);
  // It should NOT be prefixed because we skipped compression logic entirely
  expect(raw?.startsWith(REDIS_GZIP_PREFIX)).toBe(false);
});

test('handles mSet and mGet', async () => {
  const k1 = 'test:m1';
  const k2 = 'test:m2';

  await redisCompressed.mSet({
    [k1]: longString,
    [k2]: 'short',
  });

  // Check raw
  const r1 = await redis.get(k1);
  expect(r1?.startsWith(REDIS_GZIP_PREFIX)).toBe(true);
  const r2 = await redis.get(k2);
  expect(r2).toBe('short');

  // Check mGet
  const [v1, v2] = await redisCompressed.mGet([k1, k2]);
  expect(v1).toBe(longString);
  expect(v2).toBe('short');
});

test('proxies non-overridden methods correctly (zAdd/zRank)', async () => {
  const key = 'test:zset_proxy';

  // zAdd is not overridden, so it passes through to the target
  // This verifies the 'bind' fix is working, otherwise this would throw
  // "TypeError: Cannot read private member..."
  await redisCompressed.zAdd(key, { member: 'user1', score: 100 });

  // zRank is not overridden
  const rank = await redisCompressed.zRank(key, 'user1');
  expect(rank).toBe(0);
});
