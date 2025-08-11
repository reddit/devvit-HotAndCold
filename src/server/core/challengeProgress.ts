import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';
import { Challenge } from './challenge';
import { PROGRESS_POLL_TTL_SECONDS } from '../../shared/config';

export namespace ChallengeProgress {
  let cachedTtl = PROGRESS_POLL_TTL_SECONDS;
  export const setCachedTtl = (ttl: number) => {
    cachedTtl = ttl;
  };

  export const StartKey = (challengeNumber: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:start` as const;
  export const ProgressKey = (challengeNumber: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:progress` as const;
  // Consolidated per-player info for batch fetches: JSON { avatar?: string, progress?: number }
  export const PlayerInfoHashKey = (challengeNumber: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:info` as const;
  // Fully hydrated bucket (≤100 entries) cached briefly for single‑GET hot path
  const BucketHydratedKey = (challengeNumber: number, bucketStartRank: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:startBucketHydrated:${bucketStartRank}` as const;

  /**
   * Record that a player started the challenge at a timestamp (ms).
   * Stores in a ZSET keyed by start time for neighbor queries.
   */
  export const markPlayerStarted = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: zodRedditUsername,
      startedAtMs: z.number().gte(0),
      avatar: z.string().optional(),
    }),
    async ({ challengeNumber, username, startedAtMs, avatar }) => {
      await redis.zAdd(StartKey(challengeNumber), {
        member: username,
        score: startedAtMs,
      });
      // Merge avatar into consolidated info (preserve existing progress if present)
      const prev = await redis.hGet(PlayerInfoHashKey(challengeNumber), username);
      const prevObj = prev ? (JSON.parse(prev) as { avatar?: string; progress?: number }) : {};
      const nextObj = { ...prevObj, ...(avatar ? { avatar } : {}) };
      await redis.hSet(PlayerInfoHashKey(challengeNumber), { [username]: JSON.stringify(nextObj) });
    }
  );

  /**
   * Upsert a player's progress (0..100) into a per-challenge ZSET.
   */
  export const upsertProgress = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: zodRedditUsername,
      progress: z.number().min(0).max(100),
    }),
    async ({ challengeNumber, username, progress }) => {
      await redis.zAdd(ProgressKey(challengeNumber), {
        member: username,
        score: Math.round(progress),
      });
      // Merge progress into consolidated info (preserve existing avatar if present)
      const prev = await redis.hGet(PlayerInfoHashKey(challengeNumber), username);
      const prevObj = prev ? (JSON.parse(prev) as { avatar?: string; progress?: number }) : {};
      const nextObj = { ...prevObj, progress: Math.round(progress) };
      await redis.hSet(PlayerInfoHashKey(challengeNumber), { [username]: JSON.stringify(nextObj) });
    }
  );

  /**
   * Fetch up to (windowBefore + windowAfter + 1) players centered around the
   * provided user's start-time rank for the challenge, and include each
   * player's latest progress from the progress ZSET.
   */
  export const getNearestByStartTime = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: zodRedditUsername,
      windowBefore: z.number().int().min(0).max(200).default(10),
      windowAfter: z.number().int().min(0).max(200).default(10),
    }),
    async ({ challengeNumber, username, windowBefore, windowAfter }) => {
      const rank = await redis.zRank(StartKey(challengeNumber), username);

      if (rank == null) {
        // User hasn't started (no rank) – return just them with 0 progress
        return [
          {
            username,
            progress: 0,
            isPlayer: true,
            avatar: undefined,
          },
        ];
      }

      // Bucket neighbors by 100 ranks for caching and blast radius reduction
      const bucketStart = Math.floor(rank / 100) * 100;
      const bucketEnd = bucketStart + 99;
      // Retained for potential future full-hydration caching
      // const cacheKey = BucketCacheKey(challengeNumber, bucketStart);

      // 1) Build hydrated bucket if needed: zRange + HMGET once, then cache briefly
      const cacheKey = BucketHydratedKey(challengeNumber, bucketStart);
      const cachedHydrated = await redis.get(cacheKey);
      let hydrated:
        | Array<{ username: string; progress: number; avatar?: string | undefined }>
        | undefined;
      const nowMs = Date.now();
      if (cachedHydrated) {
        const parsed = JSON.parse(cachedHydrated) as {
          ts: number;
          entries: Array<{ username: string; progress: number; avatar?: string | undefined }>;
        };
        const ageMs = nowMs - Number(parsed.ts);
        if (ageMs <= cachedTtl * 1000) {
          hydrated = parsed.entries.slice(0, 100);
        }
      }
      if (!hydrated) {
        const neighbors = await redis.zRange(StartKey(challengeNumber), bucketStart, bucketEnd, {
          by: 'rank',
        });
        if (!neighbors || neighbors.length === 0) {
          return [
            {
              username,
              progress: 0,
              isPlayer: true,
              avatar: undefined,
            },
          ];
        }
        const usernames = neighbors.map((n) => n.member);
        const infos = await redis.hMGet(PlayerInfoHashKey(challengeNumber), usernames);
        hydrated = usernames
          .map((u, i) => {
            const info = infos[i]
              ? (JSON.parse(infos[i]!) as { avatar?: string; progress?: number })
              : {};
            return {
              username: u,
              progress: Math.max(0, Math.min(100, Math.round(Number(info.progress ?? 0)))),
              avatar: info.avatar,
            };
          })
          .slice(0, 100);
        await redis.set(cacheKey, JSON.stringify({ ts: nowMs, entries: hydrated }));
        await redis.expire(cacheKey, cachedTtl);
      }

      // 2) Compute requested window around current user within the stable bucket
      const pos = hydrated.findIndex((m) => m.username === username);
      if (pos < 0) {
        // Fallback – user not yet in hydrated bucket members (e.g., cached bucket).
        // Use the known rank to approximate a window around the user from the hydrated list.
        const approxPos = Math.min(Math.max(rank - bucketStart, 0), hydrated.length - 1);
        const sliceStart = Math.max(0, approxPos - windowBefore);
        const sliceEnd = Math.min(hydrated.length - 1, approxPos + windowAfter);
        const windowed = hydrated.slice(sliceStart, sliceEnd + 1);
        // Try to read player's own info for better fidelity
        const selfInfoRaw = await redis.hGet(PlayerInfoHashKey(challengeNumber), username);
        const selfInfo = selfInfoRaw
          ? (JSON.parse(selfInfoRaw) as { avatar?: string; progress?: number })
          : undefined;
        const selfEntry = {
          username,
          progress: Math.max(0, Math.min(100, Math.round(Number(selfInfo?.progress ?? 0)))),
          isPlayer: true,
          avatar: selfInfo?.avatar,
        } as const;
        // Include self + neighbors, de-duped by username
        const merged = [selfEntry, ...windowed]
          .filter((v, i, arr) => arr.findIndex((w) => w.username === v.username) === i)
          .map((e) => ({ ...e, isPlayer: e.username === username }));
        return merged;
      }
      const sliceStart = Math.max(0, pos - windowBefore);
      const sliceEnd = Math.min(hydrated.length - 1, pos + windowAfter);
      const windowed = hydrated.slice(sliceStart, sliceEnd + 1);
      return windowed.map((e) => ({ ...e, isPlayer: e.username === username }));
    }
  );
}
