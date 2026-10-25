import { expect, vi } from 'vitest';
import { context, reddit, redis, runWithContext, scheduler } from '@devvit/web/server';
import { test } from '../test';
import { moderationRouter } from './moderation';
import { Challenge } from './challenge';
import { WordQueue } from './wordQueue';
import { User } from './user';
import { UserGuess } from './userGuess';
import { ChallengeLeaderboard } from './challengeLeaderboard';
import * as api from './api';
import { isPlaytestContext, PLAYTEST_CHALLENGE_BASE } from '../../shared/playtest';

function setup() {
  const user = () => ({
    id: context.userId!,
    username: context.username ?? 'testuser',
    isAdmin: false,
  });
  const spies = [
    vi.spyOn(reddit, 'getUserById').mockImplementation(async () => user() as any),
    vi
      .spyOn(reddit, 'getModerators')
      .mockImplementation(() => ({ all: async () => [user()] }) as any),
    vi.spyOn(User, 'getCurrent').mockImplementation(async () => user()),
    vi
      .spyOn(api, 'getWordConfigCached')
      .mockResolvedValue({ word: 'apple', similar_words: [] } as any),
  ];
  const post = { id: 't3_fixture', url: 'https://reddit.com/comments/fixture' };
  const submit = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(post as any);
  const lookup = vi.spyOn(reddit, 'getPostById').mockResolvedValue(post as any);
  const schedule = vi.spyOn(scheduler, 'runJob');
  return {
    submit,
    schedule,
    restore: () => [...spies, submit, lookup, schedule].forEach((spy) => spy.mockRestore()),
  };
}

const inPlaytest = <T>(fn: () => Promise<T>, overrides: Partial<typeof context> = {}) =>
  runWithContext({ ...context, appVersion: '0.7.1.42', postId: 't3_fixture', ...overrides }, fn);

test('test tools fail closed for releases, missing context, and the production community', async () => {
  const mocks = setup();
  const caller = moderationRouter.createCaller({});
  try {
    for (const value of [
      { appVersion: '0.7.1' },
      { appVersion: '' },
      { appVersion: '0.7.1.42', subredditName: 'HotAndCold' },
    ]) {
      expect(isPlaytestContext({ subredditName: 'testsub', ...value })).toBe(false);
      await inPlaytest(async () => {
        await expect(caller.createTestPost({ word: 'apple' })).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        await expect(caller.testRun()).rejects.toMatchObject({ code: 'FORBIDDEN' });
        await expect(
          caller.resetTestRun({
            state: 'fresh',
            expectedChallengeNumber: PLAYTEST_CHALLENGE_BASE + 1,
          })
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }, value);
    }
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(await redis.get('playtest:run-sequence')).toBeUndefined();
  } finally {
    mocks.restore();
  }
});

test('non-moderators cannot create, read, or reset disposable runs in a playtest build', async () => {
  const mocks = setup();
  const mods = vi.spyOn(reddit, 'getModerators').mockReturnValue({ all: async () => [] } as any);
  const caller = moderationRouter.createCaller({});
  try {
    await inPlaytest(async () => {
      await expect(caller.createTestPost({ word: 'apple' })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(caller.testRun()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        caller.resetTestRun({
          state: 'solved',
          expectedChallengeNumber: PLAYTEST_CHALLENGE_BASE + 1,
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  } finally {
    mods.mockRestore();
    mocks.restore();
  }
});

test('test posts reuse a known word without consuming the daily queue or sending reminders', async () => {
  const mocks = setup();
  const caller = moderationRouter.createCaller({});
  await Challenge.setCurrentChallengeNumber({ number: 7 });
  await WordQueue.append({ challenge: { word: 'ocean' } });
  try {
    await inPlaytest(async () => {
      expect(await caller.createTestPost({ word: 'APPLE' })).toEqual({
        postUrl: 'https://reddit.com/comments/fixture',
      });
      await caller.createTestPost({ word: 'apple' });
      const run = await caller.testRun();
      expect(run.challengeNumber).toBeGreaterThan(PLAYTEST_CHALLENGE_BASE);
      expect(run.word).toBe('apple');
      expect(Challenge.ChallengeKey(run.challengeNumber)).toMatch(/^playtest:challenge:/);
      expect(
        await UserGuess.getChallengeUserInfo({
          username: 'testuser',
          challengeNumber: run.challengeNumber,
        })
      ).toMatchObject({ guesses: [] });
      expect(await redis.expireTime(Challenge.ChallengeKey(run.challengeNumber))).toBeGreaterThan(
        Date.now() / 1000
      );
      expect(
        await redis.expireTime(UserGuess.Key(run.challengeNumber, 'testuser'))
      ).toBeGreaterThan(Date.now() / 1000);
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ entry: 'playtest', postData: { kind: 'playtest-game' } })
    );
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(await Challenge.getCurrentChallengeNumber()).toBe(7);
    expect(await WordQueue.peekAll()).toEqual([{ word: 'ocean' }]);
  } finally {
    mocks.restore();
  }
});

test('jumping to solved and resetting use fresh isolated state, including after a late old guess', async () => {
  const mocks = setup();
  const caller = moderationRouter.createCaller({});
  try {
    await inPlaytest(async () => {
      await caller.createTestPost({ word: 'apple' });
      const original = await caller.testRun();
      const solved = await caller.resetTestRun({
        state: 'solved',
        expectedChallengeNumber: original.challengeNumber,
      });
      const solvedInfo = await UserGuess.getChallengeUserInfo({
        username: 'testuser',
        challengeNumber: solved.challengeNumber,
      });
      expect(solvedInfo.solvedAtMs).toBeGreaterThan(0);
      expect(solvedInfo.guesses).toMatchObject([{ word: 'apple', rank: 0 }]);
      expect(await redis.zCard(ChallengeLeaderboard.ScoreKey(solved.challengeNumber))).toBe(1);
      expect(
        await redis.expireTime(ChallengeLeaderboard.ScoreKey(solved.challengeNumber))
      ).toBeGreaterThan(Date.now() / 1000);
      const fresh = await caller.resetTestRun({
        state: 'fresh',
        expectedChallengeNumber: solved.challengeNumber,
      });
      expect(fresh.challengeNumber).not.toBe(solved.challengeNumber);
      await UserGuess.submitGuesses({
        username: 'testuser',
        challengeNumber: original.challengeNumber,
        guesses: [{ word: 'apple', rank: 0, similarity: 1 }],
      });
      expect(await caller.testRun()).toEqual(fresh);
      const info = await UserGuess.getChallengeUserInfo({
        username: 'testuser',
        challengeNumber: fresh.challengeNumber,
      });
      expect(info.guesses).toEqual([]);
      expect(info.solvedAtMs).toBeUndefined();
      expect(await redis.zCard(ChallengeLeaderboard.ScoreKey(fresh.challengeNumber))).toBe(0);
      expect(await Challenge.getCurrentChallengeNumber()).toBe(0);
    });
  } finally {
    mocks.restore();
  }
});

test('resetting cannot affect a daily post or another moderator’s run', async () => {
  const mocks = setup();
  const caller = moderationRouter.createCaller({});
  try {
    await inPlaytest(async () => {
      await caller.createTestPost({ word: 'apple' });
      const first = await caller.testRun();
      const other = await inPlaytest(() => caller.testRun(), {
        userId: 't2_other',
        username: 'othermod',
      });
      await caller.resetTestRun({ state: 'fresh', expectedChallengeNumber: first.challengeNumber });
      expect(
        await inPlaytest(() => caller.testRun(), { userId: 't2_other', username: 'othermod' })
      ).toEqual(other);
      await expect(
        caller.resetTestRun({ state: 'fresh', expectedChallengeNumber: other.challengeNumber })
      ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      await expect(
        inPlaytest(() => caller.testRun(), { postId: 't3_daily' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  } finally {
    mocks.restore();
  }
});
