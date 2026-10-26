import { TRPCError } from '@trpc/server';
import { context, redis } from '@devvit/web/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const AUDIO_ENABLED_KEY = 'audio:enabled';

export const audioSettingsRouter = router({
  get: publicProcedure.query(async () => {
    const stored = context.userId ? await redis.hGet(AUDIO_ENABLED_KEY, context.userId) : undefined;
    return { enabled: stored === '1' ? true : stored === '0' ? false : null };
  }),
  set: publicProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
    if (!context.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    // Preserve explicit choices across posts; unset accounts default to muted on the client.
    // One field per account, never a new record for each post or music milestone.
    await redis.hSet(AUDIO_ENABLED_KEY, { [context.userId]: input.enabled ? '1' : '0' });
    return { enabled: input.enabled };
  }),
});
