import { expect } from 'vitest';
import { context, redis, runWithContext } from '@devvit/web/server';
import { test } from '../test';
import { AUDIO_ENABLED_KEY, audioSettingsRouter } from './audioSettings';

test('sound defaults to muted, follows the signed-in account across posts, and removes opted-out fields', async () => {
  const caller = audioSettingsRouter.createCaller({});
  expect(await caller.get()).toEqual({ enabled: false });
  await caller.set({ enabled: true, userId: 't2_someoneelse' } as any);
  expect(await redis.hGet(AUDIO_ENABLED_KEY, context.userId!)).toBe('1');
  expect(await redis.hGet(AUDIO_ENABLED_KEY, 't2_someoneelse')).toBeUndefined();
  await runWithContext({ ...context, postId: 't3_another' }, async () => {
    expect(await caller.get()).toEqual({ enabled: true });
  });
  await runWithContext({ ...context, userId: 't2_another' }, async () => {
    expect(await caller.get()).toEqual({ enabled: false });
  });
  await caller.set({ enabled: false });
  expect(await caller.get()).toEqual({ enabled: false });
  expect(await redis.hGet(AUDIO_ENABLED_KEY, context.userId!)).toBeUndefined();
});

test('logged-out visitors cannot create account preferences', async () => {
  const caller = audioSettingsRouter.createCaller({});
  await runWithContext({ ...context, userId: undefined }, async () => {
    expect(await caller.get()).toEqual({ enabled: false });
    await expect(caller.set({ enabled: true })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  await expect(caller.set({ enabled: 'true' } as any)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
  });
});
