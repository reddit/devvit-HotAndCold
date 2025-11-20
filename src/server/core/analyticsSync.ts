import { z } from 'zod';
import { fn } from '../../shared/fn';
import { context, scheduler, redis } from '@devvit/web/server';
import { Reminders } from './reminder';
import { JoinedSubreddit } from './joinedSubreddit';
import { PostHog } from 'posthog-node';
import { makeClientConfig } from '../../shared/makeClientConfig';
import { hash } from '../../shared/hash';
import { User } from './user';
import { shouldSampleUser } from '../../shared/posthogUtils';

export namespace AnalyticsSync {
  const POSTHOG_HOST = 'https://us.i.posthog.com';
  const DEFAULT_LIMIT = 10_000;
  const REQUEUE_DELAY_MS = 2_000;

  async function makePosthog(): Promise<PostHog> {
    const isProd = context.subredditName === 'HotAndCold';
    const key = makeClientConfig(isProd).POSTHOG_KEY;
    return new PostHog(key, { host: POSTHOG_HOST });
  }

  export const syncBatch = fn(
    z.object({
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(1000).default(DEFAULT_LIMIT),
    }),
    async ({ cursor, limit }) => {
      const startMs = Date.now();
      console.log('[AnalyticsSync] Starting user batch', { cursor, limit });
      const posthog = await makePosthog();

      try {
        const { cursor: nextCursor, fieldValues } = await redis.hScan(
          User.UsernameToIdKey(),
          cursor,
          undefined,
          limit
        );

        const ops = await Promise.all(
          fieldValues.map(
            async ({ field: username, value: userId }: { field: string; value: string }) => {
              if (!username || !userId) return null;
              const distinctId = await hash(userId);

              if (!shouldSampleUser(distinctId)) {
                return null;
              }

              const [isJoined, isOptedIn] = await Promise.all([
                JoinedSubreddit.isUserJoinedSubreddit({ username }),
                Reminders.isUserOptedIntoReminders({ username }),
              ]);

              if (!isJoined && !isOptedIn) {
                return null;
              }

              const properties: Record<string, any> = {};
              if (isJoined) properties.joined_subreddit = true;
              if (isOptedIn) properties.opted_into_reminders = true;

              return { distinctId, properties };
            }
          )
        );

        const validOps = ops.filter(
          (op): op is { distinctId: string; properties: Record<string, any> } => op !== null
        );

        await Promise.allSettled(
          validOps.map((op) =>
            posthog.identifyImmediate({
              distinctId: op.distinctId,
              properties: op.properties,
            })
          )
        );

        const elapsedMs = Date.now() - startMs;
        console.log('[AnalyticsSync] Processed user batch', {
          scanned: fieldValues.length,
          identified: validOps.length,
          nextCursor,
          elapsedMs,
        });

        return { nextCursor, done: nextCursor === 0 } as const;
      } finally {
        await posthog.shutdown();
      }
    }
  );

  export const runOrRequeue = fn(
    z.object({
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(1000).default(DEFAULT_LIMIT),
    }),
    async ({ cursor, limit }) => {
      console.log('[AnalyticsSync] runOrRequeue invoked', { cursor, limit });
      const startMs = Date.now();
      const { nextCursor, done } = await syncBatch({ cursor, limit });

      if (!done) {
        const runAt = new Date(Date.now() + REQUEUE_DELAY_MS);
        await scheduler.runJob({
          name: 'posthog-user-prop-sync',
          runAt,
          data: { cursor: nextCursor, limit },
        });
        const elapsedMs = Date.now() - startMs;
        console.log('[AnalyticsSync] Requeued next batch', { nextCursor, runAt, elapsedMs });
        return { scheduled: true, nextCursor } as const;
      }

      console.log('[AnalyticsSync] All users complete', {
        elapsedMs: Date.now() - startMs,
      });
      return { scheduled: false, nextCursor: 0 } as const;
    }
  );
}
