import { redis } from '@devvit/web/server';
import { expect, vi } from 'vitest';
import { test } from '../test';
import {
  resetLastPlayedCleanupCursor,
  runDrainJob,
  runLastPlayedCleanupStep,
} from './userGuess.drain';
import * as sqlFlags from './sqlFlags';
import * as userGuessSql from './userGuess.sql';
import { Challenge } from './challenge';
import { ChallengeProgress } from './challengeProgress';
import { LastPlayedAt } from './lastPlayedAt';
import { UserGuess } from './userGuess';
import { redisCompressed } from './redisCompression';
import * as utils from '../utils';

const DRAIN_CURSOR_KEY = 'userGuessSql:drain:cursor';

test('scheduled drain skips when drain flag disabled', async () => {
  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(false);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);

  const result = await runDrainJob();

  expect(result.ok).toBe(true);
  expect(result.drained).toBe(0);
  expect(result.skippedReason).toBe('drain disabled');
  vi.restoreAllMocks();
});

test('scheduled drain drains from ChallengeProgress index (independent of last_played_at recency)', async () => {
  const challengeNumber = 1;
  const username = 'drain_sched_user';
  const key = UserGuess.Key(challengeNumber, username);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redis.zAdd(LastPlayedAt.getLastPlayedAtKey(), {
    member: username,
    score: Date.now() - 60_000, // recent, should still drain in scheduled path
  });
  await redis.zAdd(ChallengeProgress.StartKey(challengeNumber), {
    member: username,
    score: 1,
  });
  await redisCompressed.hSet(key, {
    guesses: JSON.stringify([
      { word: 'test', timestampMs: 1_700_000_000_000, similarity: 0.5, rank: 1, isHint: false },
    ]),
  });

  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(10);
  vi.spyOn(utils, 'getInstallationId').mockReturnValue('test-installation-id');
  const upsertSpy = vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);

  const result = await runDrainJob();

  expect(result.ok).toBe(true);
  expect(result.candidatesFound).toBe(1);
  expect(result.drained).toBe(1);
  expect(upsertSpy).toHaveBeenCalledTimes(1);

  const keyAfter = await redisCompressed.hGetAll(key);
  expect(keyAfter == null || Object.keys(keyAfter).length === 0).toBe(true);

  vi.restoreAllMocks();
  await redis.del(key);
  await redis.zRem(LastPlayedAt.getLastPlayedAtKey(), [username]);
  await redis.zRem(ChallengeProgress.StartKey(challengeNumber), [username]);
  await redis.del(DRAIN_CURSOR_KEY);
});

test('scheduled drain does not discover key if user missing from ChallengeProgress', async () => {
  const challengeNumber = 1;
  const username = 'drain_sched_missing_progress';
  const key = UserGuess.Key(challengeNumber, username);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redisCompressed.hSet(key, { guesses: '[]' });

  vi.spyOn(sqlFlags, 'isDrainEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(10);
  const upsertSpy = vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);

  const result = await runDrainJob();

  expect(result.candidatesFound).toBe(0);
  expect(result.drained).toBe(0);
  expect(upsertSpy).not.toHaveBeenCalled();

  const keyAfter = await redisCompressed.hGetAll(key);
  expect(keyAfter && Object.keys(keyAfter).length > 0).toBe(true);

  vi.restoreAllMocks();
  await redis.del(key);
  await redis.del(DRAIN_CURSOR_KEY);
});

test('last-played cleanup drains users even if not in ChallengeProgress', async () => {
  const challengeNumber = 1;
  const username = 'drain_cleanup_user';
  const key = UserGuess.Key(challengeNumber, username);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redis.zAdd(LastPlayedAt.getLastPlayedAtKey(), {
    member: username,
    score: Date.now() - 60_000,
  });
  await redisCompressed.hSet(key, { guesses: '[]' });

  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(10);
  vi.spyOn(utils, 'getInstallationId').mockReturnValue('test-installation-id');
  const upsertSpy = vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);

  const result = await runLastPlayedCleanupStep();

  expect(result.ok).toBe(true);
  expect(result.done).toBe(true);
  expect(result.candidatesFound).toBe(1);
  expect(result.drained).toBe(1);
  expect(upsertSpy).toHaveBeenCalledTimes(1);

  const keyAfter = await redisCompressed.hGetAll(key);
  expect(keyAfter == null || Object.keys(keyAfter).length === 0).toBe(true);

  vi.restoreAllMocks();
  await redis.del(key);
  await redis.zRem(LastPlayedAt.getLastPlayedAtKey(), [username]);
  await resetLastPlayedCleanupCursor();
});

test('last-played cleanup cursor daisy-chains across runs with batch size 1', async () => {
  const challengeNumber = 2;
  const username = 'drain_cleanup_cursor_user';
  const key1 = UserGuess.Key(1, username);
  const key2 = UserGuess.Key(2, username);

  await redis.set(Challenge.CurrentChallengeNumberKey(), String(challengeNumber));
  await redis.zAdd(LastPlayedAt.getLastPlayedAtKey(), {
    member: username,
    score: Date.now() - 60_000,
  });
  await redisCompressed.hSet(key1, { guesses: '[]' });
  await redisCompressed.hSet(key2, { guesses: '[]' });

  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(sqlFlags, 'getDrainBatchSize').mockResolvedValue(1);
  vi.spyOn(utils, 'getInstallationId').mockReturnValue('test-installation-id');
  vi.spyOn(userGuessSql, 'upsertUserGuessRow').mockResolvedValue(undefined);

  const first = await runLastPlayedCleanupStep();
  const second = await runLastPlayedCleanupStep();

  expect(first.drained).toBe(1);
  expect(first.done).toBe(false);
  expect(second.drained).toBe(1);
  expect(second.done).toBe(true);

  const after1 = await redisCompressed.hGetAll(key1);
  const after2 = await redisCompressed.hGetAll(key2);
  expect(after1 == null || Object.keys(after1).length === 0).toBe(true);
  expect(after2 == null || Object.keys(after2).length === 0).toBe(true);

  vi.restoreAllMocks();
  await redis.del(key1);
  await redis.del(key2);
  await redis.zRem(LastPlayedAt.getLastPlayedAtKey(), [username]);
  await resetLastPlayedCleanupCursor();
});
