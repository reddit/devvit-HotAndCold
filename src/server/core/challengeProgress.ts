import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redisCompressed as redis } from './redisCompression';
import { zodRedditUsername } from '../utils';
import { Challenge } from './challenge';
import { PROGRESS_POLL_TTL_SECONDS } from '../../shared/config';

export namespace ChallengeProgress {
  type HydratedEntry = { username: string; progress: number; avatar?: string };

  // Expire challenge player data after 8 days to reduce storage footprint.
  // Challenge metadata may persist longer, but individual player progress/rankings
  // for old challenges are cleared.
  const CHALLENGE_TTL_SECONDS = 60 * 60 * 24 * 8;

  let cachedTtl = PROGRESS_POLL_TTL_SECONDS;
  export const setCachedTtl = (ttl: number) => {
    cachedTtl = ttl;
  };

  export const StartKey = (challengeNumber: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:start` as const;
  // Consolidated per-player info for batch fetches: JSON { avatar?: string, progress?: number }
  export const PlayerInfoHashKey = (challengeNumber: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:info` as const;
  // Fully hydrated bucket (≤100 entries) cached briefly for single‑GET hot path
  const BucketHydratedKey = (challengeNumber: number, bucketStartRank: number) =>
    `${Challenge.ChallengeKey(challengeNumber)}:players:startBucketHydrated:${bucketStartRank}` as const;

  async function hydrateBucket(
    challengeNumber: number,
    bucketStart: number,
    bucketEnd: number
  ): Promise<HydratedEntry[]> {
    const cacheKey = BucketHydratedKey(challengeNumber, bucketStart);
    const cachedHydrated = await redis.get(cacheKey);
    const nowMs = Date.now();
    if (cachedHydrated) {
      const parsed = JSON.parse(cachedHydrated) as {
        ts: number;
        entries: HydratedEntry[];
      };
      const ageMs = nowMs - Number(parsed.ts);
      if (ageMs <= cachedTtl * 1000) {
        return parsed.entries.slice(0, 100);
      }
    }

    const neighbors = await redis.zRange(StartKey(challengeNumber), bucketStart, bucketEnd, {
      by: 'rank',
    });
    const usernames = neighbors.map((n) => n.member);
    const infos = usernames.length
      ? await redis.hMGet(PlayerInfoHashKey(challengeNumber), usernames)
      : [];
    const hydrated = usernames
      .map((u, i) => {
        const info = infos[i]
          ? (JSON.parse(infos[i]!) as { avatar?: string; progress?: number })
          : {};
        return {
          username: u,
          progress: Math.max(0, Math.min(100, Math.round(Number(info.progress ?? 0)))),
          avatar: info.avatar,
        } as HydratedEntry;
      })
      .slice(0, 100);

    await redis.set(cacheKey, JSON.stringify({ ts: nowMs, entries: hydrated }));
    await redis.expire(cacheKey, cachedTtl);
    return hydrated;
  }

  function sliceWindowFromHydrated(
    hydrated: HydratedEntry[],
    options:
      | {
          mode: 'center';
          username: string;
          approxIndex: number;
          windowBefore: number;
          windowAfter: number;
        }
      | { mode: 'tail'; username: string; windowBefore: number; windowAfter: number }
  ) {
    if (options.mode === 'tail') {
      const windowSize = Math.max(
        1,
        Math.min(1 + options.windowBefore + options.windowAfter, hydrated.length)
      );
      const sliceEnd = hydrated.length - 1;
      const sliceStart = Math.max(0, sliceEnd - (windowSize - 1));
      const windowed = hydrated.slice(sliceStart, sliceEnd + 1);
      const selfEntry = {
        username: options.username,
        progress: 0,
        isPlayer: true,
        avatar: undefined,
      } as const;
      return [selfEntry, ...windowed]
        .filter((v, i, arr) => arr.findIndex((w) => w.username === v.username) === i)
        .map((e) => ({ ...e, isPlayer: e.username === options.username }));
    }
    // center mode
    const sliceStart = Math.max(0, options.approxIndex - options.windowBefore);
    const sliceEnd = Math.min(hydrated.length - 1, options.approxIndex + options.windowAfter);
    const windowed = hydrated.slice(sliceStart, sliceEnd + 1);
    return windowed.map((e) => ({ ...e, isPlayer: e.username === options.username }));
  }

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
      await redis.expire(StartKey(challengeNumber), CHALLENGE_TTL_SECONDS);

      // Merge avatar into consolidated info (preserve existing progress if present)
      const prev = await redis.hGet(PlayerInfoHashKey(challengeNumber), username);
      const prevObj = prev ? (JSON.parse(prev) as { avatar?: string; progress?: number }) : {};
      const nextObj = { ...prevObj, ...(avatar ? { avatar } : {}) };
      await redis.hSet(PlayerInfoHashKey(challengeNumber), { [username]: JSON.stringify(nextObj) });
      await redis.expire(PlayerInfoHashKey(challengeNumber), CHALLENGE_TTL_SECONDS);
    }
  );

  /**
   * Upsert a player's progress (0..100).
   */
  export const upsertProgress = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: zodRedditUsername,
      progress: z.number().min(0).max(100),
    }),
    async ({ challengeNumber, username, progress }) => {
      // Merge progress into consolidated info (preserve existing avatar if present)
      const prev = await redis.hGet(PlayerInfoHashKey(challengeNumber), username);
      const prevObj = prev ? (JSON.parse(prev) as { avatar?: string; progress?: number }) : {};
      const nextObj = { ...prevObj, progress: Math.round(progress) };
      await redis.hSet(PlayerInfoHashKey(challengeNumber), { [username]: JSON.stringify(nextObj) });
      await redis.expire(PlayerInfoHashKey(challengeNumber), CHALLENGE_TTL_SECONDS);
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
        // User hasn't started (no rank) – surface the latest tranche (last ~100 by start time)
        const total = (await redis.zCard(StartKey(challengeNumber))) ?? 0;
        if (total <= 0) {
          return [
            {
              username,
              progress: 0,
              isPlayer: true,
              avatar: undefined,
            },
          ];
        }
        const bucketStart = Math.max(0, Math.floor((total - 1) / 100) * 100);
        const bucketEnd = bucketStart + 99;
        const hydrated = await hydrateBucket(challengeNumber, bucketStart, bucketEnd);
        return sliceWindowFromHydrated(hydrated, {
          mode: 'tail',
          username,
          windowBefore,
          windowAfter,
        });
      }

      // Bucket neighbors by 100 ranks for caching and blast radius reduction
      const bucketStart = Math.floor(rank / 100) * 100;
      const bucketEnd = bucketStart + 99;
      // Retained for potential future full-hydration caching
      // const cacheKey = BucketCacheKey(challengeNumber, bucketStart);

      // 1) Build hydrated bucket if needed: zRange + HMGET once, then cache briefly
      const hydrated = await hydrateBucket(challengeNumber, bucketStart, bucketEnd);
      if (!hydrated || hydrated.length === 0) {
        return [
          {
            username,
            progress: 0,
            isPlayer: true,
            avatar: undefined,
          },
        ];
      }

      // 2) Compute requested window around current user within the stable bucket
      const pos = hydrated.findIndex((m) => m.username === username);
      if (pos < 0) {
        // Fallback – user not yet in hydrated bucket members (e.g., cached bucket).
        // Use the known rank to approximate a window around the user from the hydrated list.
        const approxPos = Math.min(Math.max(rank - bucketStart, 0), hydrated.length - 1);
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
        const windowed = sliceWindowFromHydrated(hydrated, {
          mode: 'center',
          username,
          approxIndex: approxPos,
          windowBefore,
          windowAfter,
        });
        return [selfEntry, ...windowed]
          .filter((v, i, arr) => arr.findIndex((w) => w.username === v.username) === i)
          .map((e) => ({ ...e, isPlayer: e.username === username }));
      }
      const windowed = sliceWindowFromHydrated(hydrated, {
        mode: 'center',
        username,
        approxIndex: pos,
        windowBefore,
        windowAfter,
      });
      return windowed;
    }
  );
}
