import { it, expect, resetRedis } from '../test/devvitTest';
import { vi } from 'vitest';
import { reddit, settings } from '@devvit/web/server';
import { Challenge } from './challenge';
import { Notifications } from './notifications';
import { WordQueue } from './wordQueue';
import * as api from './api';

type PostLookup = Record<string, any>;

const setupPostLookup = () => {
  const lookup: PostLookup = {};
  const spy = vi.spyOn(reddit, 'getPostById').mockImplementation(async (id) => {
    const stub = lookup[id as string];
    if (!stub) {
      throw new Error(`Missing post stub for ${id}`);
    }
    return stub;
  });
  return { lookup, spy };
};

const registerPostStub = ({
  lookup,
  postId,
  postUrl,
  createdAt,
}: {
  lookup: PostLookup;
  postId: string;
  postUrl: string;
  createdAt: Date;
}) => {
  lookup[postId] = {
    id: postId,
    url: postUrl,
    createdAt,
  };
  return lookup[postId];
};

it('creates exactly one challenge within a 24 hour window', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T01:00:00.000Z'));

  const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValue({ word: 'alpha' } as any);
  const subredditSpy = vi
    .spyOn(reddit, 'getCurrentSubreddit')
    .mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockResolvedValue({ id: 't3_post1', url: 'https://example.com/p1' } as any);
  const commentSpy = vi
    .spyOn(reddit, 'submitComment')
    .mockResolvedValue({ distinguish: async () => {} } as any);
  const flairSpy = vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);
  const { lookup, spy: getPostByIdSpy } = setupPostLookup();

  try {
    const created = await Challenge.ensureLatestClassicPostOrRetry();
    expect(created.status).toBe('created');
    expect(created.challengeNumber).toBe(1);
    expect(created.postId).toBe('t3_post1');

    registerPostStub({
      lookup,
      postId: created.postId!,
      postUrl: 'https://example.com/p1',
      createdAt: new Date('2025-01-01T12:00:00.000Z'),
    });

    const again = await Challenge.ensureLatestClassicPostOrRetry();
    expect(again.status).toBe('exists');
    expect(again.challengeNumber).toBe(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(getPostByIdSpy).toHaveBeenCalledTimes(1);
    expect(notifSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subredditSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    flairSpy.mockRestore();
    notifSpy.mockRestore();
    getPostByIdSpy.mockRestore();
  }
});

it('is safe under concurrent invocations (one creates, others skip)', async () => {
  await resetRedis();
  const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValue({ word: 'bravo' } as any);
  const subredditSpy = vi
    .spyOn(reddit, 'getCurrentSubreddit')
    .mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi.spyOn(reddit, 'submitCustomPost').mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
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
    expect(notifSpy).toHaveBeenCalledTimes(1);
  } finally {
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subredditSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    settingsSpy.mockRestore();
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
  const { lookup, spy: getPostByIdSpy } = setupPostLookup();

  try {
    const first = await Challenge.ensureLatestClassicPostOrRetry();
    expect(first.status).toBe('created');
    expect(first.challengeNumber).toBe(1);
    registerPostStub({
      lookup,
      postId: first.postId!,
      postUrl: 'https://example.com/d1',
      createdAt: new Date('2025-01-01T12:00:00.000Z'),
    });

    vi.setSystemTime(new Date('2025-01-02T13:00:00.000Z'));
    const second = await Challenge.ensureLatestClassicPostOrRetry();
    expect(second.status).toBe('created');
    expect(second.challengeNumber).toBe(2);
    registerPostStub({
      lookup,
      postId: second.postId!,
      postUrl: 'https://example.com/d2',
      createdAt: new Date('2025-01-02T12:00:00.000Z'),
    });

    const third = await Challenge.ensureLatestClassicPostOrRetry();
    expect(third.status).toBe('exists');
    expect(third.challengeNumber).toBe(2);

    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(notifSpy).toHaveBeenCalledTimes(2);
    expect(getPostByIdSpy).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    getPostByIdSpy.mockRestore();
  }
});

it('makeNewChallenge uses defaults and returns existing challenge when called twice in one day', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-11T05:00:00.000Z'));

  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'delta' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockResolvedValue({ id: 't3_default1', url: 'https://example.com/d1' } as any);
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);
  const { lookup, spy: getPostByIdSpy } = setupPostLookup();

  try {
    const created = await Challenge.makeNewChallenge();
    expect(created.challenge).toBe(1);
    expect(created.postId).toBe('t3_default1');
    expect(notifSpy).toHaveBeenCalledTimes(1);

    registerPostStub({
      lookup,
      postId: created.postId,
      postUrl: created.postUrl,
      createdAt: new Date('2025-01-11T12:00:00.000Z'),
    });

    const again = await Challenge.makeNewChallenge();
    expect(again.challenge).toBe(1);
    expect(again.postId).toBe('t3_default1');
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(getPostByIdSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    getPostByIdSpy.mockRestore();
  }
});

it('allows manual override via ignoreDailyWindow', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-13T05:00:00.000Z'));

  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'theta' } as any);
  shiftSpy.mockResolvedValueOnce({ word: 'theta-override' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockImplementationOnce(
      async () => ({ id: 't3_normal', url: 'https://example.com/normal' }) as any
    )
    .mockImplementationOnce(
      async () => ({ id: 't3_override', url: 'https://example.com/override' }) as any
    );
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const notifSpy = vi
    .spyOn(Notifications, 'enqueueNewChallengeByTimezone')
    .mockResolvedValue({ groups: [], totalRecipients: 0, scheduled: 0 } as any);
  const { lookup } = setupPostLookup();

  const normal = await Challenge.makeNewChallenge();
  expect(normal.challenge).toBe(1);
  registerPostStub({
    lookup,
    postId: normal.postId,
    postUrl: normal.postUrl,
    createdAt: new Date('2025-01-13T12:00:00.000Z'),
  });

  const override = await Challenge.makeNewChallenge({ ignoreDailyWindow: true });
  expect(override.challenge).toBe(2);
  expect(override.postId).toBe('t3_override');
  expect(postSpy).toHaveBeenCalledTimes(2);
  expect(notifSpy).toHaveBeenCalledTimes(2);
});
