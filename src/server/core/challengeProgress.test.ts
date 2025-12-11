import { expect } from 'vitest';
import { ChallengeProgress } from '../core/challengeProgress';
import { test } from '../test';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const challengeNumber = 1;

test('stores start + progress and returns neighbors with avatars', async () => {
  await ChallengeProgress.markPlayerStarted({
    challengeNumber,
    username: 'alice',
    startedAtMs: Date.now(),
    avatar: 'https://example.com/a.png',
  });
  await sleep(2);
  await ChallengeProgress.markPlayerStarted({
    challengeNumber,
    username: 'bob',
    startedAtMs: Date.now(),
    avatar: 'https://example.com/b.png',
  });
  await sleep(2);
  await ChallengeProgress.markPlayerStarted({
    challengeNumber,
    username: 'carol',
    startedAtMs: Date.now(),
  });

  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'alice', progress: 10 });
  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'bob', progress: 50 });
  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'carol', progress: 80 });

  const result = await ChallengeProgress.getNearestByStartTime({
    challengeNumber,
    username: 'bob',
    windowBefore: 1,
    windowAfter: 1,
  });

  expect(result.length).toBe(3);
  const byName = Object.fromEntries(result.map((r) => [r.username, r]));
  expect(byName['alice'].progress).toBe(10);
  expect(byName['alice'].avatar).toBe('https://example.com/a.png');
  expect(byName['bob'].progress).toBe(50);
  expect(byName['bob'].isPlayer).toBe(true);
  expect(byName['carol'].progress).toBe(80);
});

test('buckets by start-time rank: users in 0..99 are separate from 100..199', async () => {
  const start = Date.now();
  // Create 105 users, 0..104
  for (let i = 0; i < 105; i++) {
    await ChallengeProgress.markPlayerStarted({
      challengeNumber,
      username: `u${i}`,
      startedAtMs: start + i,
    });
    await ChallengeProgress.upsertProgress({
      challengeNumber,
      username: `u${i}`,
      progress: i % 100,
    });
  }

  // u3 is in bucket 0..99; even with a large window, u100 shouldn't appear
  const res = await ChallengeProgress.getNearestByStartTime({
    challengeNumber,
    username: 'u3',
    windowBefore: 99,
    windowAfter: 99,
  });

  const names = res.map((r) => r.username);
  expect(names.includes('u100')).toBe(false);
  expect(names[0]).toBe('u0');
});

test('hydrated bucket cache holds for ~5s, then refreshes to show updated progress', async () => {
  const t0 = Date.now();
  await ChallengeProgress.markPlayerStarted({
    challengeNumber,
    username: 'x',
    startedAtMs: t0,
  });
  await ChallengeProgress.markPlayerStarted({
    challengeNumber,
    username: 'y',
    startedAtMs: t0 + 1,
  });
  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'x', progress: 10 });
  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'y', progress: 20 });

  const first = await ChallengeProgress.getNearestByStartTime({
    challengeNumber,
    username: 'x',
    windowBefore: 1,
    windowAfter: 1,
  });
  const firstY = first.find((p) => p.username === 'y');
  expect(firstY?.progress).toBe(20);

  // Update y's progress, immediate fetch should still read cached hydrated bucket
  await ChallengeProgress.upsertProgress({ challengeNumber, username: 'y', progress: 70 });
  const second = await ChallengeProgress.getNearestByStartTime({
    challengeNumber,
    username: 'x',
    windowBefore: 1,
    windowAfter: 1,
  });
  const secondY = second.find((p) => p.username === 'y');
  expect(secondY?.progress).toBe(20);

  ChallengeProgress.setCachedTtl(1);

  // After TTL (~5s), a new fetch should reflect latest progress
  await sleep(1200);
  const third = await ChallengeProgress.getNearestByStartTime({
    challengeNumber,
    username: 'x',
    windowBefore: 1,
    windowAfter: 1,
  });
  const thirdY = third.find((p) => p.username === 'y');
  expect(thirdY?.progress).toBe(70);
});
