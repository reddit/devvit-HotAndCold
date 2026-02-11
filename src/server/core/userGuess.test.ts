import { vi } from 'vitest';
import { expect } from 'vitest';
import { test } from '../test';
import { UserGuess } from './userGuess';
import * as userGuessSql from './userGuess.sql';
import * as sqlFlags from './sqlFlags';
import { redisCompressed } from './redisCompression';
import { User } from './user';
import * as utils from '../utils';

test('getChallengeUserInfo hydrates from SQL (drizzle) when Redis is empty and backfills Redis', async () => {
  const username = 'hydrated_user';
  const challengeNumber = 1;
  const startedAt = new Date(1_700_000_000_000);
  const guesses = [
    {
      word: 'hello',
      timestampMs: 1_700_000_001_000,
      similarity: 0.5,
      rank: 1,
      isHint: false,
    },
  ];

  const fakeRow: userGuessSql.UserGuessRow = {
    installationId: 'inst-123',
    challengeNumber,
    userId: 'mid_aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee',
    startedPlayingAt: startedAt,
    gaveUpAt: null,
    solvedAt: null,
    guesses,
    score: null,
  };

  vi.spyOn(sqlFlags, 'isForceReadFromSql').mockResolvedValue(false);
  vi.spyOn(sqlFlags, 'isSqlEnabled').mockResolvedValue(true);
  vi.spyOn(redisCompressed, 'hGetAll').mockResolvedValue({});
  vi.spyOn(userGuessSql, 'getUserGuessRow').mockResolvedValue(fakeRow);
  vi.spyOn(User, 'getOrCreateMaskedId').mockResolvedValue(fakeRow.userId);
  vi.spyOn(utils, 'getInstallationId').mockReturnValue(fakeRow.installationId);

  const hSetSpy = vi.spyOn(redisCompressed, 'hSet').mockResolvedValue(undefined);

  const info = await UserGuess.getChallengeUserInfo({ username, challengeNumber });

  expect(info.username).toBe(username);
  expect(info.startedPlayingAtMs).toBe(startedAt.getTime());
  expect(info.gaveUpAtMs).toBeUndefined();
  expect(info.solvedAtMs).toBeUndefined();
  expect(info.guesses).toEqual(guesses);
  expect(info.score).toBeUndefined();

  expect(userGuessSql.getUserGuessRow).toHaveBeenCalledWith({
    installationIdValue: fakeRow.installationId,
    challengeNumber,
    userId: fakeRow.userId,
  });

  expect(hSetSpy).toHaveBeenCalledWith(
    UserGuess.Key(challengeNumber, username),
    expect.objectContaining({
      guesses: JSON.stringify(guesses),
      startedPlayingAtMs: String(startedAt.getTime()),
    })
  );

  vi.restoreAllMocks();
});
