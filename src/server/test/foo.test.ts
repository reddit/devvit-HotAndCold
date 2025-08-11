import * as DevvitTest from './devvitTest';
import { expect } from 'vitest';
import { redis } from '@devvit/web/server';

DevvitTest.it('should be able to connect to redis', async (ctx) => {
  await redis.set('foo', 'bar');
  const value = await redis.get('foo');
  expect(value).toBe('bar');
});

DevvitTest.it('should be able to connect to redis', async (ctx) => {
  const value = await redis.get('foo');
  expect(value).toBe(undefined);
});
