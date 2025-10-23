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
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
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
