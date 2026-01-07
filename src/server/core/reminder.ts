import { z } from 'zod';
import { fn } from '../../shared/fn';
import { context, redis } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';
import { User } from './user';
import { notifications } from '@devvit/notifications';
import { T2 } from '@devvit/shared-types/tid.js';

export namespace Reminders {
  const LEGACY_REMINDERS_KEY = 'reminders' as const;
  const LEGACY_REMINDERS_T2_KEY = 'reminders_t2' as const;

  /**
   * Deletes legacy Redis keys that were previously used by this service to track reminder opt-ins.
   * Opt-in state is now managed externally by `@devvit/notifications`.
   */
  export const deleteOldReminderKeys = fn(z.void(), async () => {
    const startMs = Date.now();
    await redis.del(LEGACY_REMINDERS_KEY);
    await redis.del(LEGACY_REMINDERS_T2_KEY);
    console.log('[Reminders] deleteOldReminderKeys completed', {
      elapsedMs: Date.now() - startMs,
    });
    return { ok: true } as const;
  });

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
      await notifications.optInCurrentUser();
      await User.persistCacheForUsername(username);
    }
  );

  const isT2Id = (id: string): id is `t2_${string}` => id.startsWith('t2_');

  export const isUserOptedIntoReminders = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      const userId = await User.lookupIdByUsername(username);
      if (!userId || !isT2Id(userId)) return false;
      return await notifications.isOptedIn(userId);
    }
  );

  export const removeReminderForUsername = fn(
    z.object({
      username: zodRedditUsername,
    }),
    async ({ username }) => {
      // Only the current user can opt themselves out. In background jobs there is no `context.userId`.
      // When `context.userId` is present (e.g. request context), ensure it matches the requested username
      // to avoid opting out an unrelated user.
      if (context.userId) {
        const requestedId = await User.lookupIdByUsername(username);
        if (requestedId === context.userId) {
          await notifications.optOutCurrentUser();
        }
      }
      await User.reapplyCacheExpiryForUsername(username);
    }
  );

  export const getAllUsersOptedIntoReminders = fn(z.void(), async () => {
    type OptedInUser = { username: string; userId: `t2_${string}`; score: number };
    const all: OptedInUser[] = [];
    const baseScore = Date.now();
    let i = 0;

    // For large cohorts (~100k), avoid sequential `await User.getById()` by:
    // - paging opted-in ids via `listOptedInUsers` (limit=1000)
    // - bulk-reading cached user info via `User.getManyInfoByIds`
    // - hydrating cache misses with limited concurrency `User.getById`
    const pageSize = 1000;
    const hydrateConcurrency = 25;

    async function parallelLimit<T, R>(
      items: readonly T[],
      limit: number,
      mapper: (item: T) => Promise<R>
    ): Promise<R[]> {
      const results: R[] = new Array(items.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (true) {
          const idx = next++;
          if (idx >= items.length) return;
          results[idx] = await mapper(items[idx]!);
        }
      }
      const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
      await Promise.all(workers);
      return results;
    }

    // Page through opted-in users (ordered earliest -> latest).
    let after: string | undefined = undefined;
    let page = await notifications.listOptedInUsers({ limit: pageSize, after });
    do {
      const userIds = page.userIds.filter(isT2Id);

      const nameById = new Map<T2, string>();
      const missingIds: T2[] = [];
      if (userIds.length > 0) {
        const cachedInfoById = await User.getManyInfoByIds(userIds);
        for (const id of userIds) {
          const info = cachedInfoById[id];
          if (!info) {
            missingIds.push(id);
            continue;
          }
          nameById.set(id, info.username);
        }

        if (missingIds.length > 0) {
          const hydrated = await parallelLimit(missingIds, hydrateConcurrency, async (id) => {
            try {
              const info = await User.getById(id);
              return { id, username: info.username };
            } catch {
              return null;
            }
          });
          for (const item of hydrated) {
            if (!item) continue;
            nameById.set(item.id, item.username);
          }
        }

        // Preserve opt-in order from `notifications.listOptedInUsers`.
        for (const id of userIds) {
          const username = nameById.get(id);
          if (!username) continue;
          all.push({ username, userId: id, score: baseScore + i });
          i++;
        }
      }

      after = page.next;
      if (after) {
        page = await notifications.listOptedInUsers({ limit: pageSize, after });
      }
    } while (after);

    return all;
  });

  export const totalReminders = fn(z.void(), async () => {
    let total = 0;
    let after: string | undefined = undefined;
    let page = await notifications.listOptedInUsers({ limit: 1000, after });
    do {
      total += page.userIds.length;
      after = page.next;
      if (after) {
        page = await notifications.listOptedInUsers({ limit: 1000, after });
      }
    } while (after);
    return total;
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
              if (isT2Id(id) && (await notifications.isOptedIn(id))) {
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
