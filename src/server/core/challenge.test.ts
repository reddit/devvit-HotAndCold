import { it, expect, resetRedis } from '../test/devvitTest';
import { vi } from 'vitest';
import { redis, reddit, settings } from '@devvit/web/server';
import { Challenge } from './challenge';
import { Notifications } from './notifications';
import { WordQueue } from './wordQueue';
import * as api from './api';

it('creates exactly one challenge for the day and records marker', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T01:00:00.000Z'));

  const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValue({ word: 'alpha' } as any);
  const subSpy = vi
    .spyOn(reddit, 'getCurrentSubreddit')
    .mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementation(async () => ({ id: 't3_post1', url: 'https://example.com/p1' }) as any);
  const commentSpy = vi
    .spyOn(reddit, 'submitComment')
    .mockResolvedValue({ distinguish: async () => {} } as any);
  const flairSpy = vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    const res = await Challenge.ensureLatestClassicPostOrRetry();
    expect(res.status).toBe('created');
    expect(res.challengeNumber).toBe(1);
    expect(res.postId).toBe('t3_post1');

    // Daily marker exists and contains metadata
    const marker = await redis.get('challenge:posted:2025-01-01');
    expect(typeof marker).toBe('string');
    const parsed = JSON.parse(String(marker));
    expect(parsed.c).toBe(1);
    expect(parsed.postId).toBe('t3_post1');

    // Notifications enqueued once
    expect(notifSpy).toHaveBeenCalledTimes(1);
    // Queue consumed
    expect(shiftSpy).toHaveBeenCalledTimes(1);
    // Comment pinned attempted
    expect(commentSpy).toHaveBeenCalledTimes(1);

    // Idempotent re-run → exists
    const again = await Challenge.ensureLatestClassicPostOrRetry();
    expect(again.status).toBe('exists');
    expect(again.challengeNumber).toBe(1);
    expect(notifSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
  } finally {
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    flairSpy.mockRestore();
    notifSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('is safe under concurrent invocations (one creates, others skip)', async () => {
  await resetRedis();
  const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValue({ word: 'bravo' } as any);
  const subSpy = vi
    .spyOn(reddit, 'getCurrentSubreddit')
    .mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi.spyOn(reddit, 'submitCustomPost').mockImplementation(async () => {
    // tiny delay to widen race window
    await new Promise((r) => setTimeout(r, 5));
    return { id: 't3_conc', url: 'https://example.com/conc' } as any;
  });
  const commentSpy = vi
    .spyOn(reddit, 'submitComment')
    .mockResolvedValue({ distinguish: async () => {} } as any);
  const settingsSpy = vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    const [a, b] = await Promise.all([
      Challenge.ensureLatestClassicPostOrRetry(),
      Challenge.ensureLatestClassicPostOrRetry(),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['created', 'skipped']);
    const marker = await redis.get(`challenge:posted:${new Date().toISOString().slice(0, 10)}`);
    expect(typeof marker).toBe('string');
    expect(notifSpy).toHaveBeenCalledTimes(1);
  } finally {
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subSpy.mockRestore();
    postSpy.mockRestore();
    notifSpy.mockRestore();
  }
});

it('makeNewChallenge prevents duplicate creation under concurrency', async () => {
  await resetRedis();

  const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValueOnce({ word: 'gamma' } as any);
  const subredditSpy = vi
    .spyOn(reddit, 'getCurrentSubreddit')
    .mockResolvedValue({ name: 'testsub' } as any);
  let resolvePost: (() => void) | undefined;
  const postSpy = vi.spyOn(reddit, 'submitCustomPost').mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePost = () =>
          resolve({ id: 't3_concurrent', url: 'https://example.com/concurrent' } as any);
      })
  );
  const commentSpy = vi
    .spyOn(reddit, 'submitComment')
    .mockResolvedValue({ distinguish: async () => {} } as any);
  const settingsSpy = vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notificationsSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    const resultPromise = Promise.all([
      Challenge.makeNewChallenge({ enqueueNotifications: true }),
      Challenge.makeNewChallenge({ enqueueNotifications: true }),
    ]);

    for (let i = 0; i < 5 && typeof resolvePost !== 'function'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(typeof resolvePost).toBe('function');
    resolvePost?.();

    const [first, second] = await resultPromise;

    expect(first.postId).toBe('t3_concurrent');
    expect(second.postId).toBe('t3_concurrent');
    expect(first.challenge).toBe(1);
    expect(second.challenge).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(shiftSpy).toHaveBeenCalledTimes(1);
    expect(notificationsSpy).toHaveBeenCalledTimes(1);
  } finally {
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subredditSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    settingsSpy.mockRestore();
    notificationsSpy.mockRestore();
  }
});

it('creates a new challenge on the next UTC day with incremented number', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T02:00:00.000Z'));

  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'charlie' } as any);
  shiftSpy.mockResolvedValueOnce({ word: 'delta' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementationOnce(async () => ({ id: 't3_day1', url: 'https://example.com/d1' }) as any)
    .mockImplementationOnce(async () => ({ id: 't3_day2', url: 'https://example.com/d2' }) as any);
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    const first = await Challenge.ensureLatestClassicPostOrRetry();
    expect(first.status).toBe('created');
    expect(first.challengeNumber).toBe(1);
    expect(first.postId).toBe('t3_day1');

    // Advance to next UTC day
    vi.setSystemTime(new Date('2025-01-02T02:00:00.000Z'));
    const second = await Challenge.ensureLatestClassicPostOrRetry();
    expect(second.status).toBe('created');
    expect(second.challengeNumber).toBe(2);
    expect(second.postId).toBe('t3_day2');

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(notifSpy).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('makeNewChallenge respects daily marker and does not double-post or re-enqueue', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-05T03:00:00.000Z'));

  // Pre-mark an existing challenge for the day
  await redis.set('challenge:posted:2025-01-05', JSON.stringify({ c: 7, postId: 't3_exist' }));
  // Seed challenge config for word lookup on early return path
  await redis.hSet(Challenge.ChallengeKey(7), {
    challengeNumber: '7',
    secretWord: 'zebra',
    totalPlayers: '1',
    totalSolves: '1',
  });

  const submitSpy = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue({} as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);
  vi.spyOn(reddit, 'getPostById').mockResolvedValue({ url: 'https://example.com/existing' } as any);

  try {
    const res = await Challenge.makeNewChallenge({ enqueueNotifications: true });
    // Early-return path respected the daily marker
    expect(res.challenge).toBe(7);
    expect(res.postId).toBe('t3_exist');
    expect(submitSpy).not.toHaveBeenCalled();
    expect(notifSpy).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it('makeNewChallenge with force bypasses daily guard and creates another for same day', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-10T04:00:00.000Z'));

  // Prepare two distinct words for two creations on the same day
  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'dayone' } as any);
  shiftSpy.mockResolvedValueOnce({ word: 'dayone-forced' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementationOnce(
      async () => ({ id: 't3_first', url: 'https://example.com/first' }) as any
    )
    .mockImplementationOnce(
      async () => ({ id: 't3_forced', url: 'https://example.com/forced' }) as any
    );
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    // First creation for the day (via ensure)
    const first = await Challenge.ensureLatestClassicPostOrRetry();
    expect(first.status).toBe('created');
    expect(first.challengeNumber).toBe(1);
    expect(first.postId).toBe('t3_first');

    // Force-create another in the same day
    const forced = await Challenge.makeNewChallenge({ force: true });
    expect(forced.challenge).toBe(2);
    expect(forced.postId).toBe('t3_forced');

    // Marker updated to latest
    const postedKey = `challenge:posted:${new Date().toISOString().slice(0, 10)}`;
    const markerRaw = await redis.get(postedKey);
    const marker = JSON.parse(String(markerRaw));
    expect(marker.c).toBe(2);
    expect(marker.postId).toBe('t3_forced');

    // Current challenge number advanced
    expect(await Challenge.getCurrentChallengeNumber()).toBe(2);

    // Two posts created, notifications scheduled twice (distinct challenge numbers)
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(notifSpy).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('makeNewChallenge uses zod defaults: enqueueNotifications=true and force=false', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-11T05:00:00.000Z'));

  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'default-a' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementationOnce(
      async () => ({ id: 't3_default1', url: 'https://example.com/d1' }) as any
    );
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);

  try {
    // Call without args → defaults apply (enqueueNotifications=true, force=false)
    const created = await Challenge.makeNewChallenge();
    expect(created.challenge).toBe(1);
    expect(created.postId).toBe('t3_default1');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(notifSpy).toHaveBeenCalledTimes(1);

    // With daily marker in place, calling again without args should NOT force
    const again = await Challenge.makeNewChallenge();
    expect(again.challenge).toBe(1); // unchanged; early-return path
    expect(again.postId).toBe('t3_default1');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(notifSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
