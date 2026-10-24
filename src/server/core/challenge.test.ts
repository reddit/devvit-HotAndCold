import { expect, vi } from 'vitest';
import { reddit, settings, scheduler } from '@devvit/web/server';
import { Challenge } from './challenge';
import { WordQueue } from './wordQueue';
import * as api from './api';
import { test } from '../test';

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

test('creates exactly one challenge within a daily posting slot', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

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
  const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);
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
    expect(schedulerSpy).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subredditSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    flairSpy.mockRestore();
    schedulerSpy.mockRestore();
    getPostByIdSpy.mockRestore();
  }
});

test('is safe under concurrent invocations (one creates, others skip)', async () => {
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
  const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);

  try {
    const [a, b] = await Promise.all([
      Challenge.ensureLatestClassicPostOrRetry(),
      Challenge.ensureLatestClassicPostOrRetry(),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['created', 'skipped']);
    expect(schedulerSpy).toHaveBeenCalledTimes(1);
  } finally {
    getWordSpy.mockRestore();
    shiftSpy.mockRestore();
    subredditSpy.mockRestore();
    postSpy.mockRestore();
    commentSpy.mockRestore();
    settingsSpy.mockRestore();
    schedulerSpy.mockRestore();
  }
});

test('creates a new challenge at the next scheduled time with incremented number', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

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
  const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);
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

    vi.setSystemTime(new Date('2025-01-02T12:00:00.000Z'));
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
    expect(schedulerSpy).toHaveBeenCalledTimes(2);
    expect(getPostByIdSpy).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
    getPostByIdSpy.mockRestore();
    schedulerSpy.mockRestore();
  }
});

test('makeNewChallenge uses defaults and returns existing challenge when called twice in one day', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-11T12:00:00.000Z'));

  vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
  const shiftSpy = vi.spyOn(WordQueue, 'shift');
  shiftSpy.mockResolvedValueOnce({ word: 'delta' } as any);
  vi.spyOn(reddit, 'getCurrentSubreddit').mockResolvedValue({ name: 'testsub' } as any);
  const postSpy = vi
    .spyOn(reddit, 'submitCustomPost')
    .mockResolvedValue({ id: 't3_default1', url: 'https://example.com/d1' } as any);
  vi.spyOn(reddit, 'submitComment').mockResolvedValue({ distinguish: async () => {} } as any);
  vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
  const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);
  const { lookup, spy: getPostByIdSpy } = setupPostLookup();

  try {
    const created = await Challenge.makeNewChallenge();
    expect(created.challenge).toBe(1);
    expect(created.postId).toBe('t3_default1');
    expect(schedulerSpy).toHaveBeenCalledTimes(1);

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
    schedulerSpy.mockRestore();
  }
});

test('allows manual override via ignoreDailyWindow', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-13T12:00:00.000Z'));

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
  const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);
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
  expect(schedulerSpy).toHaveBeenCalledTimes(2);
  schedulerSpy.mockRestore();
});

const dailyPostingCases = [
  {
    name: 'posts at noon after a manual post the previous afternoon',
    previousCreatedAt: '2026-10-23T16:10:29.351Z',
    now: '2026-10-24T12:00:00.000Z',
    expectedStatus: 'created',
  },
  {
    name: 'posts at noon after a manual post the previous evening',
    previousCreatedAt: '2026-10-24T22:32:35.117Z',
    now: '2026-10-25T12:00:00.000Z',
    expectedStatus: 'created',
  },
  {
    name: 'posts at noon after a recovery post earlier on the same UTC date',
    previousCreatedAt: '2026-10-24T00:30:00.000Z',
    now: '2026-10-24T12:00:00.000Z',
    expectedStatus: 'created',
  },
  {
    name: 'does not post again before the next noon boundary',
    previousCreatedAt: '2026-10-23T12:00:00.000Z',
    now: '2026-10-24T11:59:59.999Z',
    expectedStatus: 'exists',
  },
  {
    name: 'does not duplicate a post at the exact noon boundary',
    previousCreatedAt: '2026-10-24T12:00:00.000Z',
    now: '2026-10-24T12:00:00.000Z',
    expectedStatus: 'exists',
  },
  {
    name: 'does not duplicate a successful post during a morning retry',
    previousCreatedAt: '2026-10-24T12:00:00.000Z',
    now: '2026-10-24T12:30:00.000Z',
    expectedStatus: 'exists',
  },
  {
    name: 'does not duplicate a manual recovery post within its posting slot',
    previousCreatedAt: '2026-10-24T16:10:00.000Z',
    now: '2026-10-24T22:00:00.000Z',
    expectedStatus: 'exists',
  },
] as const;

for (const { name, previousCreatedAt, now, expectedStatus } of dailyPostingCases) {
  test(name, async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));

    const getWordSpy = vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({} as any);
    const shiftSpy = vi.spyOn(WordQueue, 'shift').mockResolvedValue({ word: 'anvil' });
    const subredditSpy = vi
      .spyOn(reddit, 'getCurrentSubreddit')
      .mockResolvedValue({ name: 'testsub' } as any);
    const postSpy = vi
      .spyOn(reddit, 'submitCustomPost')
      .mockResolvedValue({ id: 't3_next', url: 'https://example.com/next' } as any);
    const commentSpy = vi
      .spyOn(reddit, 'submitComment')
      .mockResolvedValue({ distinguish: async () => {} } as any);
    const settingsSpy = vi.spyOn(settings, 'get').mockResolvedValue(undefined as any);
    const schedulerSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue({} as any);
    const { lookup, spy: getPostByIdSpy } = setupPostLookup();

    try {
      await Challenge.setChallenge({
        challengeNumber: 443,
        config: { challengeNumber: '443', secretWord: 'orchard' },
      });
      await Challenge.setPostIdForChallenge({ challengeNumber: 443, postId: 't3_previous' });
      await Challenge.setCurrentChallengeNumber({ number: 443 });
      registerPostStub({
        lookup,
        postId: 't3_previous',
        postUrl: 'https://example.com/previous',
        createdAt: new Date(previousCreatedAt),
      });

      const result = await Challenge.ensureLatestClassicPostOrRetry();
      expect(result.status).toBe(expectedStatus);
      expect(result.challengeNumber).toBe(expectedStatus === 'created' ? 444 : 443);
      const expectedCreations = expectedStatus === 'created' ? 1 : 0;
      expect(shiftSpy).toHaveBeenCalledTimes(expectedCreations);
      expect(postSpy).toHaveBeenCalledTimes(expectedCreations);
      expect(schedulerSpy).toHaveBeenCalledTimes(expectedCreations);

      if (expectedStatus === 'created') {
        registerPostStub({
          lookup,
          postId: 't3_next',
          postUrl: 'https://example.com/next',
          createdAt: new Date(now),
        });
        const retry = await Challenge.ensureLatestClassicPostOrRetry();
        expect(retry.status).toBe('exists');
        expect(retry.challengeNumber).toBe(444);
        expect(shiftSpy).toHaveBeenCalledTimes(1);
        expect(postSpy).toHaveBeenCalledTimes(1);
        expect(schedulerSpy).toHaveBeenCalledTimes(1);
      }
    } finally {
      vi.useRealTimers();
      getWordSpy.mockRestore();
      shiftSpy.mockRestore();
      subredditSpy.mockRestore();
      postSpy.mockRestore();
      commentSpy.mockRestore();
      settingsSpy.mockRestore();
      schedulerSpy.mockRestore();
      getPostByIdSpy.mockRestore();
    }
  });
}
