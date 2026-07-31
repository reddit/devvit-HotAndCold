import { z } from 'zod';
import { fn } from '../../shared/fn';
import { context } from '@devvit/web/server';
import { zodRedditUsername } from '../utils';
import { User } from './user';
import { notifications } from '@devvit/notifications';
import { T2 } from '@devvit/shared-types/tid.js';

export namespace Reminders {
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
}
