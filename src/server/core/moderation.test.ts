import { expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import { test } from '../test';
import { moderationRouter } from './moderation';
import { WordQueue } from './wordQueue';
import { Challenge } from './challenge';
import { WordConfigKey } from './api';
import * as api from './api';
import { WORD_REVEAL_DURATION_MS } from '../../shared/moderation';
import { WORD_DATA_RELEASE } from '../../shared/wordDataVersion';
import { ChallengeLeaderboard } from './challengeLeaderboard';
import { ChallengeProgress } from './challengeProgress';
import { UserGuess } from './userGuess';
import { LowQueueAlerts } from './lowQueueAlerts';
import { Admin } from './admin';

const acknowledgement = {
  purpose: 'word_issue' as const,
  reason: 'Investigating a player report about this puzzle.',
  promiseNotToCheat: true as const,
  confirmation: 'REVEAL' as const,
};

test('ordinary moderators do not gain developer tools simply by opening moderator settings', async () => {
  const role = mockRole(true);
  const admin = vi.spyOn(Admin, 'isAdmin').mockResolvedValue(false);
  try {
    const caller = moderationRouter.createCaller({});
    expect((await caller.overview()).developerToolsAvailable).toBe(false);
    admin.mockResolvedValue(true);
    expect((await caller.overview()).developerToolsAvailable).toBe(true);
  } finally {
    admin.mockRestore();
    role.restore();
  }
});

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
    await expect(caller.setLowQueueAlerts({ enabled: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(caller.queue({ page: 0, ...acknowledgement })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      caller.revealAnswer({ challengeNumber: 1, ...acknowledgement })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
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
      caller.clearWordCaches({ challengeNumbers: [1], confirm: 'CLEAR_CACHES' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await WordQueue.size()).toBe(1);
  } finally {
    role.restore();
  }
});

test('low-queue preferences affect only the requesting moderator and never send on opt-in', async () => {
  const role = mockRole(true);
  const send = vi.spyOn(reddit, 'sendPrivateMessage').mockResolvedValue();
  const caller = moderationRouter.createCaller({});
  try {
    expect(await LowQueueAlerts.isEnabled(role.user.id)).toBe(false);
    await caller.setLowQueueAlerts({
      enabled: true,
      userId: 't2_someoneelse',
      username: 'someoneelse',
    } as any);
    expect(await LowQueueAlerts.isEnabled(role.user.id)).toBe(true);
    expect(await LowQueueAlerts.isEnabled('t2_someoneelse')).toBe(false);
    expect((await caller.overview()).lowQueueAlertsEnabled).toBe(true);
    await caller.setLowQueueAlerts({ enabled: false });
    expect((await caller.overview()).lowQueueAlertsEnabled).toBe(false);
    expect(send).not.toHaveBeenCalled();
  } finally {
    send.mockRestore();
    role.restore();
  }
});

test('adding words through the console rearms alerts even when the refill is consumed before the next check', async () => {
  const role = mockRole(true);
  const send = vi.spyOn(reddit, 'sendPrivateMessage').mockResolvedValue();
  const valid = vi
    .spyOn(api, 'getWord')
    .mockImplementation(async ({ word }) => ({ data: [{ word, id: 0 }] }));
  const caller = moderationRouter.createCaller({});
  try {
    await caller.setLowQueueAlerts({ enabled: true });
    await caller.addWords({
      words: 'apple, ocean, banana, river, forest, mountain, valley, lake',
      prepend: false,
    });
    await WordQueue.shift();
    await LowQueueAlerts.check(await WordQueue.size());
    expect(send).toHaveBeenCalledTimes(1);
    await caller.addWords({ words: 'cloud', prepend: false });
    await WordQueue.shift();
    await redis.del('queueAlerts:checkLock');
    await LowQueueAlerts.check(await WordQueue.size());
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    valid.mockRestore();
    send.mockRestore();
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
  const protectedValues = {
    [WordConfigKey('banana')]: 'unselected-ranking-cache',
    [`__devvit_cache_val__static-word-data:${WORD_DATA_RELEASE}:apple.bin.gz`]: 'compact-rankings',
    [`__devvit_cache_val__static-word-data:${WORD_DATA_RELEASE}:_dictionary.csv.gz`]:
      'shared-dictionary',
  };
  await Promise.all(Object.entries(protectedValues).map(([key, value]) => redis.set(key, value)));
  await redis.hSet(Challenge.ChallengeKey(1), { secretWord: 'apple' });
  await redis.hSet(Challenge.ChallengeKey(2), { secretWord: 'banana' });
  await redis.hSet(UserGuess.Key(1, 'testuser'), { guesses: '[{"word":"box"}]' });
  await redis.zAdd(ChallengeLeaderboard.ScoreKey(1), { member: 'testuser', score: 88 });
  await redis.zAdd(ChallengeProgress.StartKey(1), { member: 'testuser', score: 1 });
  await WordQueue.append({ challenge: { word: 'ocean' } });
  try {
    const result = await moderationRouter
      .createCaller({})
      .clearWordCaches({ challengeNumbers: [1, 1], confirm: 'CLEAR_CACHES' });
    expect(result).toEqual({ cleared: 1, bytes: 15 });
    expect(await redis.get(WordConfigKey('apple'))).toBeUndefined();
    expect(await redis.hGet(Challenge.ChallengeKey(1), 'secretWord')).toBe('apple');
    expect(await redis.hGet(UserGuess.Key(1, 'testuser'), 'guesses')).toBe('[{"word":"box"}]');
    for (const [key, value] of Object.entries(protectedValues))
      expect(await redis.get(key)).toBe(value);
    expect(await redis.hGet(Challenge.ChallengeKey(2), 'secretWord')).toBe('banana');
    expect(await redis.zScore(ChallengeLeaderboard.ScoreKey(1), 'testuser')).toBe(88);
    expect(await redis.zScore(ChallengeProgress.StartKey(1), 'testuser')).toBe(1);
    expect((await WordQueue.peekAll()).map((row) => row.word)).toEqual(['ocean']);
  } finally {
    role.restore();
  }
});

test('ordinary dashboard and storage responses do not disclose answers or queued words', async () => {
  const role = mockRole(true);
  await Challenge.setCurrentChallengeNumber({ number: 1 });
  await redis.hSet(Challenge.ChallengeKey(1), {
    challengeNumber: '1',
    secretWord: 'secretanswer',
  });
  await WordQueue.append({ challenge: { word: 'secretqueuedword' } });
  const caller = moderationRouter.createCaller({});
  try {
    const overview = await caller.overview();
    expect(overview.queueSize).toBe(1);
    expect(overview.challenge).toMatchObject({ challengeNumber: '1' });
    expect(overview.challenge).not.toHaveProperty('secretWord');
    const sample = await caller.redisSample({});
    expect(sample.rows[0]).toMatchObject({ challengeNumber: 1 });
    expect(sample.rows[0]).not.toHaveProperty('word');
    expect(JSON.stringify({ overview, sample })).not.toMatch(/secretanswer|secretqueuedword/);
  } finally {
    role.restore();
  }
});

test('reveals require a reason, purpose, pledge, and exact typed confirmation on the server', async () => {
  const role = mockRole(true);
  await redis.hSet(Challenge.ChallengeKey(1), { challengeNumber: '1', secretWord: 'secretanswer' });
  await WordQueue.append({ challenge: { word: 'secretqueuedword' } });
  const caller = moderationRouter.createCaller({});
  try {
    for (const invalid of [
      {},
      { ...acknowledgement, reason: 'too short' },
      { ...acknowledgement, reason: ' '.repeat(25) },
      { ...acknowledgement, reason: 'x'.repeat(501) },
      { ...acknowledgement, purpose: 'curiosity' },
      { ...acknowledgement, promiseNotToCheat: false },
      { ...acknowledgement, confirmation: 'reveal' },
    ]) {
      await expect(caller.queue({ page: 0, ...invalid } as any)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
      await expect(
        caller.revealAnswer({ challengeNumber: 1, ...invalid } as any)
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    const now = Date.now();
    const answer = await caller.revealAnswer({ challengeNumber: 1, ...acknowledgement });
    expect(answer).toMatchObject({ challengeNumber: 1, word: 'secretanswer' });
    expect(answer.expiresAtMs).toBeGreaterThanOrEqual(now + WORD_REVEAL_DURATION_MS);
    const queue = await caller.queue({ page: 0, ...acknowledgement });
    expect(queue).toMatchObject({ page: 0, words: [{ word: 'secretqueuedword' }] });
    expect(queue.expiresAtMs).toBeGreaterThanOrEqual(now + WORD_REVEAL_DURATION_MS);
  } finally {
    role.restore();
  }
});

test('publishing from the new console does not disclose answers in results or errors', async () => {
  const role = mockRole(true);
  const create = vi.spyOn(Challenge, 'makeNewChallenge').mockResolvedValue({
    challenge: 2,
    word: 'secretanswer',
    postId: 't3_new',
    postUrl: 'https://reddit.com/comments/new',
  });
  const recover = vi
    .spyOn(Challenge, 'ensureLatestClassicPostOrRetry')
    .mockRejectedValue(new Error('Static target unavailable: secretanswer'));
  const caller = moderationRouter.createCaller({});
  try {
    const result = await caller.postNext({ confirm: 'POST', skipNotifications: true });
    expect(result).toMatchObject({ challenge: 2, postId: 't3_new' });
    expect(result).not.toHaveProperty('word');
    create.mockRejectedValue(new Error('Static target unavailable: secretanswer'));
    for (const action of [
      () => caller.postNext({ confirm: 'POST', skipNotifications: true }),
      () => caller.recoverPost(),
    ]) {
      await expect(action()).rejects.not.toThrow('secretanswer');
    }
  } finally {
    create.mockRestore();
    recover.mockRestore();
    role.restore();
  }
});
