import { it, expect, resetRedis } from '../test/devvitTest';
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

it('getById returns cached user and updates mapping caches', async () => {
  await resetRedis();

  const id = 't2_alice';
  const cached = { id, username: 'alice', snoovatar: 'https://snoo/a.png' };
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getUserById').mockResolvedValue(undefined as any);
  try {
    const info = await User.getById(id);
    expect(info).toEqual(cached);

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'alice');
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe('alice');
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('getById fetches from reddit on cache miss and caches the result', async () => {
  await resetRedis();

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
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe('bob');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('getById throws when reddit returns null', async () => {
  await resetRedis();
  const id = 't2_missing';
  const spy = vi.spyOn(reddit, 'getUserById').mockResolvedValue(null as any);
  try {
    await expect(User.getById(id)).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});

it('getByUsername returns from cache via mapping and updates id->username', async () => {
  await resetRedis();

  const id = 't2_carol';
  const username = 'carol';
  const cached = { id, username };
  await redis.hSet(User.UsernameToIdKey(), { [username]: id });
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(undefined as any);
  try {
    const info = await User.getByUsername(username);
    expect(info).toEqual({ id, username, snoovatar: undefined });

    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(i2u).toBe(username);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('getByUsername falls back to reddit when mapping exists but user cache missing', async () => {
  await resetRedis();

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
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe(username);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('getByUsername fetches from reddit and caches when mapping is missing', async () => {
  await resetRedis();

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
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe(username);
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('lookupIdByUsername returns id from cache mapping', async () => {
  await resetRedis();

  await redis.hSet(User.UsernameToIdKey(), { frank: 't2_frank' });
  const id = await User.lookupIdByUsername('frank');
  expect(id).toBe('t2_frank');
});

it('lookupIdByUsername resolves via reddit and populates caches on miss', async () => {
  await resetRedis();

  const spy = vi
    .spyOn(reddit, 'getUserByUsername')
    .mockResolvedValue(makeRedditUser('t2_grace', 'grace') as any);
  try {
    const id = await User.lookupIdByUsername('grace');
    expect(id).toBe('t2_grace');

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'grace');
    const i2u = await redis.hGet(User.IdToUsernameKey(), 't2_grace');
    expect(u2i).toBe('t2_grace');
    expect(i2u).toBe('grace');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('lookupIdByUsername returns null when reddit lookup fails', async () => {
  await resetRedis();
  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(null as any);
  try {
    const id = await User.lookupIdByUsername('harry');
    expect(id).toBeNull();
  } finally {
    spy.mockRestore();
  }
});

it('getCurrent returns cached current user and updates mapping caches', async () => {
  await resetRedis();

  const id = String(context.userId);
  const cached = { id, username: 'ivy' };
  await redis.set(User.Key(id), JSON.stringify(cached));

  const spy = vi.spyOn(reddit, 'getCurrentUser').mockResolvedValue(undefined as any);
  try {
    const info = await User.getCurrent(undefined);
    expect(info).toEqual({ id, username: 'ivy', snoovatar: undefined });

    const u2i = await redis.hGet(User.UsernameToIdKey(), 'ivy');
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe('ivy');
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('getCurrent fetches from reddit on cache miss and caches the result', async () => {
  await resetRedis();

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
    const i2u = await redis.hGet(User.IdToUsernameKey(), id);
    expect(u2i).toBe(id);
    expect(i2u).toBe('jack');
    expect(spy).toHaveBeenCalledTimes(1);
  } finally {
    spy.mockRestore();
  }
});

it('getCurrent throws when no user is in context', async () => {
  await resetRedis();

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

it('getByUsername throws when reddit returns null', async () => {
  await resetRedis();
  const spy = vi.spyOn(reddit, 'getUserByUsername').mockResolvedValue(null as any);
  try {
    await expect(User.getByUsername('zoe')).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});

it('getCurrent throws when reddit returns null on cache miss', async () => {
  await resetRedis();
  const spy = vi.spyOn(reddit, 'getCurrentUser').mockResolvedValue(null as any);
  try {
    await expect(User.getCurrent(undefined)).rejects.toThrow(/User not found/);
  } finally {
    spy.mockRestore();
  }
});
