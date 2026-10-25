import { expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import { test } from '../test';
import { moderationRouter } from './moderation';
import { WordQueue } from './wordQueue';
import { Challenge } from './challenge';
import { WordConfigKey } from './api';
import * as api from './api';

function mockRole(moderator: boolean) {
  const user = { id: 't2_testuser', username: 'testuser', isAdmin: true };
  const userSpy = vi.spyOn(reddit, 'getUserById').mockResolvedValue(user as any);
  const mods = vi.spyOn(reddit, 'getModerators').mockReturnValue({
    all: async () => (moderator ? [user] : []),
  } as any);
  return {
    user,
    mods,
    restore: () => {
      userSpy.mockRestore();
      mods.mockRestore();
    },
  };
}

test('moderator APIs deny non-mods even when their Reddit admin flag is true', async () => {
  const role = mockRole(false);
  const caller = moderationRouter.createCaller({});
  await WordQueue.append({ challenge: { word: 'apple' } });
  try {
    expect(await caller.access()).toEqual({ isModerator: false });
    await expect(caller.overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.queue({ page: 0 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.addWords({ words: 'banana', prepend: false })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.clearQueue({ confirm: 'CLEAR' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.recoverPost()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.postNext({ confirm: 'POST', skipNotifications: true })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.redisSample({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      caller.clearWordCaches({ words: ['apple'], confirm: 'CLEAR_CACHES' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await WordQueue.size()).toBe(1);
  } finally {
    role.restore();
  }
});

test('moderator status is checked again after access is revoked', async () => {
  const role = mockRole(true);
  const caller = moderationRouter.createCaller({});
  try {
    expect(await caller.access()).toEqual({ isModerator: true });
    role.mods.mockReturnValue({ all: async () => [] } as any);
    await expect(caller.overview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    role.restore();
  }
});

test('queue preview normalizes input and skips used, queued, repeated, and invalid words', async () => {
  const role = mockRole(true);
  const valid = vi.spyOn(api, 'getWord').mockImplementation(async ({ word }) => ({
    data: word === 'missing' ? [] : [{ word, id: 0 }],
  }));
  await Challenge.setCurrentChallengeNumber({ number: 1 });
  await redis.hSet(Challenge.ChallengeKey(1), { secretWord: 'apple' });
  await WordQueue.append({ challenge: { word: 'ocean' } });
  const caller = moderationRouter.createCaller({});
  try {
    expect(
      await caller.previewWords({ words: ' Apple, ocean, Banana, banana, missing, !!!' })
    ).toEqual([
      { word: 'apple', status: 'used' },
      { word: 'ocean', status: 'queued' },
      { word: 'banana', status: 'ready' },
      { word: 'banana', status: 'duplicate' },
      { word: 'missing', status: 'invalid' },
      { word: '!!!', status: 'invalid' },
    ]);
    expect(
      await caller.addWords({ words: 'Banana, banana, apple, missing', prepend: false })
    ).toEqual({ added: 1, skipped: 3 });
    expect((await WordQueue.peekAll()).map((item) => item.word)).toEqual(['ocean', 'banana']);
  } finally {
    valid.mockRestore();
    role.restore();
  }
});

test('cache cleanup is restricted to ranking caches and preserves game data', async () => {
  const role = mockRole(true);
  await redis.set(WordConfigKey('apple'), 'cached-rankings');
  await redis.hSet(Challenge.ChallengeKey(1), { secretWord: 'apple' });
  await redis.hSet('challenge:1:user:testuser', { guesses: '[{"word":"box"}]' });
  try {
    const result = await moderationRouter
      .createCaller({})
      .clearWordCaches({ words: ['apple'], confirm: 'CLEAR_CACHES' });
    expect(result).toEqual({ cleared: 1, bytes: 15 });
    expect(await redis.get(WordConfigKey('apple'))).toBeUndefined();
    expect(await redis.hGet(Challenge.ChallengeKey(1), 'secretWord')).toBe('apple');
    expect(await redis.hGet('challenge:1:user:testuser', 'guesses')).toBe('[{"word":"box"}]');
  } finally {
    role.restore();
  }
});
