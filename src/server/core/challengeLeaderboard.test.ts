import { expect } from 'vitest';
import { test } from '../test';
import { ChallengeLeaderboard } from '../core/challengeLeaderboard';

const challengeNumber = 42;

test('adds entries and returns score leaderboard in DESC (best to worst)', async () => {
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'alice',
    score: 10,
    timeToCompleteMs: 2000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'bob',
    score: 25,
    timeToCompleteMs: 4000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'carol',
    score: 15,
    timeToCompleteMs: 1500,
  });

  const top = await ChallengeLeaderboard.getLeaderboardByScore({
    challengeNumber,
    start: 0,
    stop: 2,
    sort: 'DESC',
  });

  // Expect bob (25), carol (15), alice (10)
  expect(top.map((m) => m.member)).toEqual(['bob', 'carol', 'alice']);
  expect(top.map((m) => m.score)).toEqual([25, 15, 10]);
});

test('returns fastest leaderboard with lower times first when sort is DESC (best to worst)', async () => {
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'alice',
    score: 10,
    timeToCompleteMs: 2000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'bob',
    score: 25,
    timeToCompleteMs: 4000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'carol',
    score: 15,
    timeToCompleteMs: 1500,
  });

  const fastestDesc = await ChallengeLeaderboard.getLeaderboardByFastest({
    challengeNumber,
    start: 0,
    stop: 2,
    sort: 'DESC',
  });

  // Lower time is better: carol (1500), alice (2000), bob (4000)
  expect(fastestDesc.map((m) => m.member)).toEqual(['carol', 'alice', 'bob']);
  expect(fastestDesc.map((m) => m.score)).toEqual([1500, 2000, 4000]);

  const fastestAsc = await ChallengeLeaderboard.getLeaderboardByFastest({
    challengeNumber,
    start: 0,
    stop: 2,
    sort: 'ASC',
  });
  // ASC means worst to best for our public API; for fastest that means higher times first
  expect(fastestAsc.map((m) => m.member)).toEqual(['bob', 'alice', 'carol']);
});

test('returns 0-based best rank for score and fastest', async () => {
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'alice',
    score: 50,
    timeToCompleteMs: 3000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'bob',
    score: 20,
    timeToCompleteMs: 1000,
  });
  await ChallengeLeaderboard.addEntry({
    challengeNumber,
    username: 'carol',
    score: 40,
    timeToCompleteMs: 2000,
  });

  // Score ranks (higher better): alice(50)=0, carol(40)=1, bob(20)=2
  // Fastest ranks (lower better): bob(1000)=0, carol(2000)=1, alice(3000)=2
  const alice = await ChallengeLeaderboard.getRankingsForMember({
    challengeNumber,
    username: 'alice',
  });
  const bob = await ChallengeLeaderboard.getRankingsForMember({
    challengeNumber,
    username: 'bob',
  });
  const carol = await ChallengeLeaderboard.getRankingsForMember({
    challengeNumber,
    username: 'carol',
  });

  expect(alice).toEqual({ score: 0, timeToSolve: 2 });
  expect(bob).toEqual({ score: 2, timeToSolve: 0 });
  expect(carol).toEqual({ score: 1, timeToSolve: 1 });
});

test('throws when reading leaderboard that has no entries', async () => {
  await expect(
    ChallengeLeaderboard.getLeaderboardByScore({ challengeNumber, start: 0, stop: 0, sort: 'DESC' })
  ).rejects.toThrow('No leaderboard found');

  await expect(
    ChallengeLeaderboard.getLeaderboardByFastest({
      challengeNumber,
      start: 0,
      stop: 0,
      sort: 'DESC',
    })
  ).rejects.toThrow('No leaderboard found');
});
