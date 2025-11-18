import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';
import { User } from './user';

export namespace Reminders {
  // Original to make it super explicit since we might let people play the archive on any postId
  export const getRemindersKey = () => `reminders` as const;
  const CLEANUP_CANCEL_KEY = 'userCacheCleanup:cancel' as const;
  const CLEANUP_STATS_KEY = 'userCacheCleanup:stats' as const;

  type CleanupStatsSnapshot = {
    totalCleared: number;
    totalExamined: number;
    totalBytes: number;
    totalDurationMs: number;
    runs: number;
    lastCursor: number;
    lastRunAt: number;
    done: boolean;
  };

  export type CleanupStatsSummary = CleanupStatsSnapshot & {
    totalMegabytes: number;
  };

  export type CleanupRunResult = {
    cleared: number;
    examined: number;
    iterations: number;
    estimatedBytes: number;
    estimatedMegabytes: number;
    durationMs: number;
    lastCursor: number;
    done: boolean;
  };

  const defaultCleanupStats = (): CleanupStatsSnapshot => ({
    totalCleared: 0,
    totalExamined: 0,
    totalBytes: 0,
    totalDurationMs: 0,
    runs: 0,
    lastCursor: 0,
    lastRunAt: 0,
    done: false,
  });

  const withMegabytes = (stats: CleanupStatsSnapshot): CleanupStatsSummary => ({
    ...stats,
    totalMegabytes: stats.totalBytes / (1024 * 1024),
  });

  const parseCleanupStats = (raw: string | null | undefined): CleanupStatsSnapshot => {
    if (!raw) return defaultCleanupStats();
    try {
      const parsed = JSON.parse(raw) as Partial<CleanupStatsSnapshot>;
      return {
        ...defaultCleanupStats(),
        ...parsed,
      };
    } catch {
      return defaultCleanupStats();
    }
  };

  export const getCleanupStats = async (): Promise<CleanupStatsSummary> => {
    const raw = await redis.get(CLEANUP_STATS_KEY);
    return withMegabytes(parseCleanupStats(raw));
  };

  export const recordCleanupRun = async (run: CleanupRunResult): Promise<CleanupStatsSummary> => {
    const existing = parseCleanupStats(await redis.get(CLEANUP_STATS_KEY));
    const updated: CleanupStatsSnapshot = {
      totalCleared: existing.totalCleared + run.cleared,
      totalExamined: existing.totalExamined + run.examined,
      totalBytes: existing.totalBytes + run.estimatedBytes,
      totalDurationMs: existing.totalDurationMs + run.durationMs,
      runs: existing.runs + 1,
      lastCursor: run.lastCursor,
      lastRunAt: Date.now(),
      done: run.done,
    };
    await redis.set(CLEANUP_STATS_KEY, JSON.stringify(updated));
    return withMegabytes(updated);
  };

  export const isCleanupJobCancelled = async () => {
    return (await redis.get(CLEANUP_CANCEL_KEY)) === '1';
  };

  export const setCleanupJobCancelled = async (enabled: boolean) => {
    if (enabled) {
      await redis.set(CLEANUP_CANCEL_KEY, '1');
    } else {
      await redis.del(CLEANUP_CANCEL_KEY);
    }
  };

  export const setReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zAdd(getRemindersKey(), {
        member: username,
        score: Date.now(),
      });
      await User.persistCacheForUsername(username);
    }
  );

  export const isUserOptedIntoReminders = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const score = await redis.zScore(getRemindersKey(), username);
      return score !== null && score !== undefined;
    }
  );

  export const removeReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      await redis.zRem(getRemindersKey(), [username]);
      await User.reapplyCacheExpiryForUsername(username);
    }
  );

  export const getAllUsersOptedIntoReminders = fn(z.void(), async () => {
    const all: Array<{ member: string; score: number }> = [];
    let cursor = 0;
    const limit = 1000;

    do {
      const { cursor: nextCursor, members } = await redis.zScan(
        getRemindersKey(),
        cursor,
        undefined,
        limit
      );
      for (const m of members) {
        all.push({ member: m.member, score: m.score });
      }
      cursor = nextCursor ?? 0;
    } while (cursor !== 0);

    all.sort((a, b) => a.score - b.score);
    return all;
  });

  // Batched scan by rank for large reconciliations
  export const scanUsers = fn(
    z.object({
      cursor: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(1000).default(500),
    }),
    async ({ cursor, limit }) => {
      const { cursor: nextCursor, members } = await redis.zScan(
        getRemindersKey(),
        Math.max(0, cursor),
        undefined,
        Math.max(1, limit)
      );
      const list = members.map((m) => m.member);
      return { members: list, nextCursor, done: nextCursor === 0 } as const;
    }
  );

  export const totalReminders = fn(z.void(), async () => {
    return await redis.zCard(getRemindersKey());
  });

  export const toggleReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const isOptedIn = await isUserOptedIntoReminders({ username });

      if (isOptedIn) {
        await removeReminderForUsername({ username });
        return { newValue: false };
      } else {
        await setReminderForUsername({ username });
        return { newValue: true };
      }
    }
  );

  export const clearCacheForNonReminderUsers = fn(
    z.object({
      startAt: z.number().int().min(0).default(0),
      totalIterations: z.number().int().min(1).max(10_000).default(1000),
      count: z.number().int().min(1).max(1000).default(250),
    }),
    async ({ startAt, totalIterations, count }) => {
      const startedAt = Date.now();
      const logEvery = 500;
      const entriesPerJobLimit = 25_000;
      const remindersKey = getRemindersKey();
      let cursor = Math.max(0, startAt);
      const maxIterations = Math.max(1, totalIterations);
      let cleared = 0;
      let estimatedBytes = 0;
      let examined = 0;
      let iterations = 0;
      let hitEntryLimit = false;

      if (await isCleanupJobCancelled()) {
        console.log('[UserCacheCleanup] Cancel flag enabled before run; skipping cleanup pass.');
        return {
          cleared: 0,
          examined: 0,
          iterations: 0,
          estimatedBytes: 0,
          estimatedMegabytes: 0,
          durationMs: 0,
          lastCursor: startAt,
          done: false,
        } satisfies CleanupRunResult;
      }

      const totalUsers = await redis.hLen(User.UsernameToIdKey());

      console.log('[UserCacheCleanup] Starting cleanup', {
        startAt,
        totalIterations,
        count,
        totalUsers,
      });

      const logProgress = () => {
        const reclaimedMb = estimatedBytes / (1024 * 1024);
        console.log(
          `[UserCacheCleanup] Cleared ${cleared} cache entr${cleared === 1 ? 'y' : 'ies'} (~${reclaimedMb.toFixed(
            2
          )} MiB reclaimed).`
        );
      };

      do {
        const { cursor: nextCursor, fieldValues } = await redis.hScan(
          User.UsernameToIdKey(),
          cursor,
          undefined,
          count
        );
        cursor = nextCursor ?? 0;
        iterations++;

        const tasks = fieldValues
          .map(({ field: username, value: id }) => {
            if (!username || !id) return null;
            return (async () => {
              const score = await redis.zScore(remindersKey, username);
              if (score !== null && score !== undefined) {
                return { examinedDelta: 1, clearedDelta: 0, bytesDelta: 0 };
              }

              const cacheKey = User.Key(id);
              const size = await redis.strLen(cacheKey);
              if (!size || size <= 0) {
                return { examinedDelta: 1, clearedDelta: 0, bytesDelta: 0 };
              }

              await redis.del(cacheKey);
              return { examinedDelta: 1, clearedDelta: 1, bytesDelta: size };
            })();
          })
          .filter(Boolean) as Array<
          Promise<{ examinedDelta: number; clearedDelta: number; bytesDelta: number }>
        >;

        const settled = await Promise.allSettled(tasks);
        for (const result of settled) {
          if (result.status !== 'fulfilled') continue;
          examined += result.value.examinedDelta;
          if (result.value.clearedDelta > 0) {
            const prevCleared = cleared;
            cleared += result.value.clearedDelta;
            estimatedBytes += result.value.bytesDelta;
            const prevBucket = Math.floor(prevCleared / logEvery);
            const nextBucket = Math.floor(cleared / logEvery);
            if (nextBucket > prevBucket) {
              logProgress();
            }
          }
        }
        if (!hitEntryLimit && examined >= entriesPerJobLimit) {
          hitEntryLimit = true;
          console.log(
            `[UserCacheCleanup] Hit per-run entry limit (${entriesPerJobLimit}) at cursor ${cursor}. Pausing to requeue.`
          );
        }
        if (!hitEntryLimit && (await isCleanupJobCancelled())) {
          hitEntryLimit = true;
          console.log('[UserCacheCleanup] Cancel flag detected mid-run; stopping early.');
        }
      } while (cursor !== 0 && iterations < maxIterations && !hitEntryLimit);

      if (cleared > 0 && cleared % logEvery !== 0) {
        logProgress();
      }

      const done = cursor === 0;

      return {
        cleared,
        examined,
        iterations,
        estimatedBytes,
        estimatedMegabytes: estimatedBytes / (1024 * 1024),
        durationMs: Date.now() - startedAt,
        lastCursor: cursor,
        done,
      } satisfies CleanupRunResult;
    }
  );
}
