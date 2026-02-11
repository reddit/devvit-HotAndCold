import { redis } from '@devvit/web/server';
import { vi } from 'vitest';
import { expect } from 'vitest';
import { test } from '../test';
import { runDrainJob } from './userGuess.drain';
import * as sqlFlags from './sqlFlags';
import * as userGuessSql from './userGuess.sql';
import { Challenge } from './challenge';
import { LastPlayedAt } from './lastPlayedAt';
import { UserGuess } from './userGuess';
import { redisCompressed } from './redisCompression';
import * as utils from '../utils';

const STALE_USERNAME = 'drain_test_stale_user';
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

test('runDrainJob skips when drain or SQL disabled', async () => {
  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(false);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);

  const result = await runDrainJob();

  expect(result.ok).toBe(true);
  expect(result.drained).toBe(0);
  expect(result.skippedReason).toBe('drain disabled');
  vi.restoreAllMocks();
});

test('runDrainJob finds no candidates when no stale user data in Redis', async () => {
  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(50);

  const result = await runDrainJob();

  expect(result.ok).toBe(true);
  expect(result.candidatesFound).toBe(0);
  expect(result.drained).toBe(0);
  expect(result.skippedReason).toBeUndefined();
  vi.restoreAllMocks();
});

test('runDrainJob collects candidate from Redis when user has not played in 3h', async () => {
  const challengeNumber = 1;
  const key = UserGuess.Key(challengeNumber, STALE_USERNAME);
  const guessesPayload = JSON.stringify([
    { word: 'test', timestampMs: 1_700_000_000_000, similarity: 0.5, rank: 1, isHint: false },
  ]);
  const startedPlayingAtMs = String(1_700_000_000_000);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redis.zAdd(LastPlayedAt.getLastPlayedAtKey(), {
    member: STALE_USERNAME,
    score: Date.now() - THREE_HOURS_MS - 60_000,
  });
  await redisCompressed.hSet(key, {
    guesses: guessesPayload,
    startedPlayingAtMs,
  });

  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(10);

  const upsertSpy = vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);
  vi.spyOn(utils, 'getInstallationId').mockReturnValue('test-installation-id');

  const result = await runDrainJob();

  expect(result.candidatesFound).toBe(1);
  expect(result.drained).toBe(1);
  expect(result.ok).toBe(true);

  expect(upsertSpy).toHaveBeenCalledTimes(1);
  const [upsertArg] = upsertSpy.mock.calls[0];
  expect(upsertArg.challengeNumber).toBe(challengeNumber);
  expect(upsertArg.guesses).toHaveLength(1);
  expect(upsertArg.guesses[0].word).toBe('test');
  expect(upsertArg.startedPlayingAt).toEqual(new Date(1_700_000_000_000));
  expect(upsertArg.userId).toMatch(/^mid_/);

  const keyAfter = await redisCompressed.hGetAll(key);
  expect(keyAfter == null || Object.keys(keyAfter).length === 0).toBe(true);

  vi.restoreAllMocks();
  await redis.del(key);
  await redis.zRem(LastPlayedAt.getLastPlayedAtKey(), [STALE_USERNAME]);
});

test('runDrainJob does not collect user who played recently', async () => {
  const recentUsername = 'drain_test_recent_user';
  const challengeNumber = 1;
  const key = UserGuess.Key(challengeNumber, recentUsername);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redis.zAdd(LastPlayedAt.getLastPlayedAtKey(), {
    member: recentUsername,
    score: Date.now() - 60_000,
  });
  await redisCompressed.hSet(key, { guesses: '[]' });

  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(10);

  const upsertSpy = vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);

  const result = await runDrainJob();

  expect(result.candidatesFound).toBe(0);
  expect(result.drained).toBe(0);
  expect(upsertSpy).not.toHaveBeenCalled();

  vi.restoreAllMocks();
  await redis.del(key);
  await redis.zRem(LastPlayedAt.getLastPlayedAtKey(), [recentUsername]);
});
