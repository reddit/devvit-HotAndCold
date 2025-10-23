import { z } from 'zod';
import { fn } from '../../shared/fn';
import { context, scheduler } from '@devvit/web/server';
import { Reminders } from './reminder';
import { JoinedSubreddit } from './joinedSubreddit';
import { PostHog } from 'posthog-node';
import { makeClientConfig } from '../../shared/makeClientConfig';
import { hash } from '../../shared/hash';
import { User } from './user';

export namespace AnalyticsSync {
  const POSTHOG_HOST = 'https://us.i.posthog.com';
  const DEFAULT_LIMIT = 500;
  const REQUEUE_DELAY_MS = 2_000;

  type Stage = 'reminders' | 'joined';

  async function makePosthog(): Promise<PostHog> {
    const isProd = context.subredditName === 'HotAndCold';
    const key = makeClientConfig(isProd).POSTHOG_KEY;
    return new PostHog(key, { host: POSTHOG_HOST });
  }

  async function usernamesToDistinctIds(usernames: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const username of usernames) {
      const id = await User.lookupIdByUsername(username);
      if (id) results.push(await hash(id));
    }
    return results;
  }

  export const syncBatch = fn(
    z.object({
      stage: z.enum(['reminders', 'joined']).default('reminders'),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(1000).default(DEFAULT_LIMIT),
    }),
    async ({ stage, cursor, limit }) => {
      const startMs = Date.now();
      console.log('[AnalyticsSync] Starting batch', { stage, cursor, limit });
      const posthog = await makePosthog();
      try {
        if (stage === 'reminders') {
          const batch = await Reminders.scanUsers({ cursor, limit });
          console.log('[AnalyticsSync] Fetched reminders batch', {
            members: batch.members.length,
            nextCursor: batch.nextCursor,
            done: batch.done,
          });
          const distinctIds = await usernamesToDistinctIds(batch.members);
          await Promise.allSettled(
            distinctIds.map((distinctId) =>
              posthog.identify({ distinctId, properties: { opted_into_reminders: true } })
            )
          );
          const elapsedMs = Date.now() - startMs;
          console.log('[AnalyticsSync] Identified reminders users', {
            count: distinctIds.length,
            elapsedMs,
          });
          const result = { nextCursor: batch.nextCursor, done: batch.done, stage } as const;
          console.log('[AnalyticsSync] Completed reminders batch', { ...result, elapsedMs });
          return result;
        } else {
          const batch = await JoinedSubreddit.scanUsers({ cursor, limit });
          console.log('[AnalyticsSync] Fetched joined batch', {
            members: batch.members.length,
            nextCursor: batch.nextCursor,
            done: batch.done,
          });
          const distinctIds = await usernamesToDistinctIds(batch.members);
          await Promise.allSettled(
            distinctIds.map((distinctId) =>
              posthog.identify({ distinctId, properties: { joined_subreddit: true } })
            )
          );
          const elapsedMs = Date.now() - startMs;
          console.log('[AnalyticsSync] Identified joined users', {
            count: distinctIds.length,
            elapsedMs,
          });
          const result = { nextCursor: batch.nextCursor, done: batch.done, stage } as const;
          console.log('[AnalyticsSync] Completed joined batch', { ...result, elapsedMs });
          return result;
        }
      } finally {
        await posthog.shutdown();
      }
    }
  );

  export const runOrRequeue = fn(
    z.object({
      stage: z.enum(['reminders', 'joined'] as const).default('reminders'),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(1000).default(DEFAULT_LIMIT),
    }),
    async ({ stage, cursor, limit }) => {
      console.log('[AnalyticsSync] runOrRequeue invoked', { stage, cursor, limit });
      const startMs = Date.now();
      const { nextCursor, done } = await syncBatch({ stage, cursor, limit });
      if (!done) {
        const runAt = new Date(Date.now() + REQUEUE_DELAY_MS);
        await scheduler.runJob({
          name: 'posthog-user-prop-sync',
          runAt,
          data: { stage, cursor: nextCursor, limit },
        });
        const elapsedMs = Date.now() - startMs;
        console.log('[AnalyticsSync] Requeued next batch', { stage, nextCursor, runAt, elapsedMs });
        return { scheduled: true, stage, nextCursor } as const;
      }

      if (stage === 'reminders') {
        const runAt = new Date(Date.now() + REQUEUE_DELAY_MS);
        await scheduler.runJob({
          name: 'posthog-user-prop-sync',
          runAt,
          data: { stage: 'joined', cursor: 0, limit },
        });
        const elapsedMs = Date.now() - startMs;
        console.log('[AnalyticsSync] Reminders stage done; switching to joined', {
          nextStage: 'joined',
          runAt,
          elapsedMs,
        });
        return { scheduled: true, stage: 'joined' as Stage, nextCursor: 0 } as const;
      }

      console.log('[AnalyticsSync] All stages complete', {
        stage,
        cursor,
        limit,
        elapsedMs: Date.now() - startMs,
      });
      return { scheduled: false, stage, nextCursor } as const;
    }
  );
}
