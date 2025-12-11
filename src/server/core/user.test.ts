import { test } from '../test';
import { expect } from 'vitest';
import { vi } from 'vitest';
import { redis, reddit, context } from '@devvit/web/server';
import { Context, runWithContext } from '@devvit/server';
import { Header } from '@devvit/shared-types/Header.js';
import { User } from './user';

const makeRedditUser = (id: string, username: string, snoo?: string) => ({
  id,
  username,
  getSnoovatarUrl: async () => snoo,
});

test('getById returns cached user and updates mapping caches', async () => {
  const id = 't2_alice';
  const cached = { id, username: 'alice', snoovatar: 'https://snoo/a.png' };
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getUserById').mockResolvedValue(undefined as any);
  try {
    const info = await User.getById(id);
    expect(info).toEqual(cached);

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'alice');
    expect(u2i).toBe(id);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test('getById fetches from reddit on cache miss and caches the result', async () => {
  const id = 't2_bob';
  const spy = vi
    .spyOn(reddit, 'getUserById')
    .mockResolvedValue(makeRedditUser(id, 'bob', 'https://snoo/b.png') as any);

  try {
    const info = await User.getById(id);
    expect(info).toEqual({ id, username: 'bob', snoovatar: 'https://snoo/b.png' });

    const raw = await redis.get(User.Key(id));
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(String(raw));
    expect(parsed).toEqual(info);

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'bob');
    expect(u2i).toBe(id);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test('getById throws when reddit returns null', async () => {
  const id = 't2_missing';
  const spy = vi.spyOn(reddit, 'getUserById').mockResolvedValue(null as any);
  try {
    await expect(User.getById(id)).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});

test('getByUsername returns from cache via mapping and updates id->username', async () => {
  const id = 't2_carol';
  const username = 'carol';
  const cached = { id, username };
  await redis.hSet(User.UsernameToIdKey(), { [username]: id });
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(undefined as any);
  try {
    const info = await User.getByUsername(username);
    expect(info).toEqual({ id, username, snoovatar: undefined });

    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test('getByUsername falls back to reddit when mapping exists but user cache missing', async () => {
  const id = 't2_dana';
  const username = 'dana';
  await redis.hSet(User.UsernameToIdKey(), { [username]: id });

  const spy = vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue(makeRedditUser(id, username) as any);

  try {
    const info = await User.getByUsername(username);
    expect(info).toEqual({ id, username, snoovatar: undefined });

    const raw = await redis.get(User.Key(id));
    const parsed = JSON.parse(String(raw));
    expect(parsed).toEqual(info);

    const u2i = await redis.hGet(User.UsernameToIdKey(), username);
    expect(u2i).toBe(id);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test('getByUsername fetches from reddit and caches when mapping is missing', async () => {
  const id = 't2_erin';
  const username = 'erin';
  const spy = vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue(makeRedditUser(id, username, 'https://snoo/e.png') as any);

  try {
    const info = await User.getByUsername(username);
    expect(info).toEqual({ id, username, snoovatar: 'https://snoo/e.png' });

    const raw = await redis.get(User.Key(id));
    const parsed = JSON.parse(String(raw));
    expect(parsed).toEqual(info);

    const u2i = await redis.hGet(User.UsernameToIdKey(), username);
    expect(u2i).toBe(id);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test('lookupIdByUsername returns id from cache mapping', async () => {
  await redis.hSet(User.UsernameToIdKey(), { frank: 't2_frank' });
  const id = await User.lookupIdByUsername('frank');
  expect(id).toBe('t2_frank');
});

test('lookupIdByUsername resolves via reddit and populates caches on miss', async () => {
  const spy = vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue(makeRedditUser('t2_grace', 'grace') as any);
  try {
    const id = await User.lookupIdByUsername('grace');
    expect(id).toBe('t2_grace');

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'grace');
    expect(u2i).toBe('t2_grace');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test('lookupIdByUsername returns null when reddit lookup fails', async () => {
  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(null as any);
  try {
    const id = await User.lookupIdByUsername('harry');
    expect(id).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

test('getCurrent returns cached current user and updates mapping caches', async () => {
  const id = String(context.userId);
  const cached = { id, username: 'ivy' };
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getCurrentUser').mockResolvedValue(undefined as any);
  try {
    const info = await User.getCurrent(undefined);
    expect(info).toEqual({ id, username: 'ivy', snoovatar: undefined });

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'ivy');
    expect(u2i).toBe(id);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test('getCurrent fetches from reddit on cache miss and caches the result', async () => {
  const id = String(context.userId);
  const spy = vi
    .spyOn(reddit, 'getCurrentUser')
    .mockResolvedValue(makeRedditUser(id, 'jack', 'https://snoo/j.png') as any);
  try {
    const info = await User.getCurrent(undefined);
    expect(info).toEqual({ id, username: 'jack', snoovatar: 'https://snoo/j.png' });

    const raw = await redis.get(User.Key(id));
    const parsed = JSON.parse(String(raw));
    expect(parsed).toEqual(info);

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'jack');
    expect(u2i).toBe(id);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

test('applies a 15-day expiry to cached user data', async () => {
  const id = 't2_ttl_user';
  const spy = vi
    .spyOn(reddit, 'getUserById')
    .mockResolvedValue(makeRedditUser(id, 'ttluser') as any);
  try {
    await User.getById(id);
  } finally {
    spy.mockRestore();
  }
  const expireTime = await redis.expireTime(User.Key(id));
  const ttlRemaining = expireTime - Math.floor(Date.now() / 1000);
  expect(ttlRemaining).toBeGreaterThanOrEqual(User.CacheTtlSeconds - 30);
  expect(ttlRemaining).toBeLessThanOrEqual(User.CacheTtlSeconds + 1);
});

test('getCurrent throws when no user is in context', async () => {
  const headers = {
    [Header.Subreddit]: 't5_testsub',
    [Header.SubredditName]: 'testsub',
    [Header.App]: 'test-app',
    [Header.Version]: '0.0.0-test',
    [Header.AppUser]: 't2_testuser',
    [Header.AppViewerAuthToken]: 'test-token',
  } as Record<string, string>;

  await runWithContext(Context(headers), async () => {
    await expect(User.getCurrent(undefined)).rejects.toThrow(/User not found/);
  });
});

test('getByUsername throws when reddit returns null', async () => {
  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(null as any);
  try {
    await expect(User.getByUsername('zoe')).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});

test('getCurrent throws when reddit returns null on cache miss', async () => {
  const spy = vi.spyOn(reddit, 'getCurrentUser').mockResolvedValue(null as any);
  try {
    await expect(User.getCurrent(undefined)).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});
