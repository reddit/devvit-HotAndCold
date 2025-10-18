import { z } from 'zod';
import { fn } from '../../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../../utils';
import { User } from '../user';

export namespace HordeGuess {
  // ZSET of words scored by best (lowest) rank seen so far
  export const RankKey = (challengeNumber: number) =>
    `horde:challenge:${challengeNumber}:guessesByRank` as const;

  // Per-word ZSET of authors who have guessed this word (score = timestamp)
  export const AuthorsKey = (challengeNumber: number, word: string) =>
    `horde:challenge:${challengeNumber}:guess:${word}:authors` as const;

  export const add = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      word: z.string().trim().toLowerCase(),
      username: zodRedditUsername,
      rank: z.number(),
      similarity: z.number(),
    }),
    async ({ challengeNumber, word, username, rank }) => {
      // Ignore invalid ranks for the global leaderboard
      if (!Number.isFinite(rank) || rank < 0) {
        // Still record author participation for analytics if desired
        await redis.zAdd(AuthorsKey(challengeNumber, word), {
          member: username,
          score: Date.now(),
        });
        return;
      }

      const current = await redis.zScore(RankKey(challengeNumber), word);
      if (current === null || current === undefined || rank < current) {
        await redis.zAdd(RankKey(challengeNumber), { member: word, score: rank });
      }

      // Always add author to per-word authorship set (deduped by member)
      await redis.zAdd(AuthorsKey(challengeNumber, word), {
        member: username,
        score: Date.now(),
      });
    }
  );

  // Per-wave variant of the above structures
  export const WaveRankKey = (challengeNumber: number, wave: number) =>
    `horde:challenge:${challengeNumber}:wave:${wave}:guessesByRank` as const;
  export const WaveAuthorsKey = (challengeNumber: number, wave: number, word: string) =>
    `horde:challenge:${challengeNumber}:wave:${wave}:guess:${word}:authors` as const;

  export const addWave = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      wave: z.number().int().min(1),
      word: z.string().trim().toLowerCase(),
      username: zodRedditUsername,
      rank: z.number(),
      similarity: z.number(),
    }),
    async ({ challengeNumber, wave, word, username, rank }) => {
      // Ignore invalid ranks for the wave leaderboard
      if (!Number.isFinite(rank) || rank < 0) {
        await redis.zAdd(WaveAuthorsKey(challengeNumber, wave, word), {
          member: username,
          score: Date.now(),
        });
        return;
      }
      const key = WaveRankKey(challengeNumber, wave);
      const current = await redis.zScore(key, word);
      if (current === null || current === undefined || rank < current) {
        await redis.zAdd(key, { member: word, score: rank });
      }
      await redis.zAdd(WaveAuthorsKey(challengeNumber, wave, word), {
        member: username,
        score: Date.now(),
      });
    }
  );

  export const getWaveTopByRank = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      wave: z.number().int().min(1),
      limit: z.number().int().min(1).max(1000).default(25),
    }),
    async ({ challengeNumber, wave, limit }) => {
      const items = await redis.zRange(WaveRankKey(challengeNumber, wave), 0, limit - 1, {
        by: 'rank',
      });
      const result: Array<{ word: string; rank: number; username: string }> = [];
      const usernames: string[] = [];
      for (const it of items) {
        const authorsZ = await redis.zRange(WaveAuthorsKey(challengeNumber, wave, it.member), 0, 0, {
          by: 'rank',
        });
        const username = authorsZ[0]?.member ?? '';
        result.push({ word: it.member, rank: it.score, username });
        if (username) usernames.push(username);
      }
      const avatarMap = await hydrateSnoovatars(usernames);
      return result.map((entry) => ({
        ...entry,
        ...(entry.username && avatarMap.get(entry.username)
          ? { snoovatar: avatarMap.get(entry.username) }
          : {}),
      }));
    }
  );

  export const getTopByRank = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      limit: z.number().int().min(1).max(1000).default(25),
    }),
    async ({ challengeNumber, limit }) => {
      const items = await redis.zRange(RankKey(challengeNumber), 0, limit - 1, {
        by: 'rank',
      });
      const result: Array<{ word: string; bestRank: number; authors: string[] }> = [];
      for (const it of items) {
        const authorsZ = await redis.zRange(AuthorsKey(challengeNumber, it.member), 0, -1, {
          by: 'rank',
        });
        const authors = authorsZ.map((a) => a.member);
        result.push({ word: it.member, bestRank: it.score, authors });
      }
      return result;
    }
  );

  // Count guesses per user for this challenge (for top N guessers by quantity)
  export const GuesserCountKey = (challengeNumber: number) =>
    `horde:challenge:${challengeNumber}:guesserCounts` as const;

  export const incrementGuesserCount = fn(
    z.object({ challengeNumber: z.number().gt(0), username: zodRedditUsername }),
    async ({ challengeNumber, username }) => {
      await redis.zIncrBy(GuesserCountKey(challengeNumber), username, 1);
    }
  );

  export const topGuessers = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      limit: z.number().int().min(1).max(100).default(20),
    }),
    async ({ challengeNumber, limit }) => {
      // Get highest scores first by grabbing tail then reversing
      const results = await redis.zRange(GuesserCountKey(challengeNumber), -limit, -1, {
        by: 'rank',
      });
      const ordered = results.reverse();
      const usernames = ordered.map((r) => r.member);
      const avatarMap = await hydrateSnoovatars(usernames);
      return ordered.map((entry) => ({
        ...entry,
        ...(entry.member && avatarMap.get(entry.member)
          ? { snoovatar: avatarMap.get(entry.member) }
          : {}),
      }));
    }
  );

  async function hydrateSnoovatars(usernames: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(usernames.filter((name) => !!name)));
    if (unique.length === 0) return new Map();
    const pairs = await Promise.all(
      unique.map(async (name) => {
        try {
          const info = await User.getCachedByUsername(name);
          return [name, info?.snoovatar ?? null] as const;
        } catch {
          return [name, null] as const;
        }
      })
    );
    const map = new Map<string, string>();
    for (const [name, avatar] of pairs) {
      if (avatar) map.set(name, avatar);
    }
    return map;
  }

  export const clear = fn(
    z.object({ challengeNumber: z.number().gt(0) }),
    async ({ challengeNumber }) => {
      // Delete the main rank set; leave author sets as-is to avoid large scans
      await redis.del(RankKey(challengeNumber));
    }
  );
}
