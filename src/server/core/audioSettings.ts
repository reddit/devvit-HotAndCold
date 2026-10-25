import { TRPCError } from '@trpc/server';
import { context, redis } from '@devvit/web/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';

export const AUDIO_ENABLED_KEY = 'audio:enabled';

export const audioSettingsRouter = router({
  get: publicProcedure.query(async () => ({
    enabled: context.userId ? (await redis.hGet(AUDIO_ENABLED_KEY, context.userId)) === '1' : false,
  })),
  set: publicProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ input }) => {
    if (!context.userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
    // Muted is the default: only explicit opt-ins consume storage. No per-post records.
    if (input.enabled) await redis.hSet(AUDIO_ENABLED_KEY, { [context.userId]: '1' });
    else await redis.hDel(AUDIO_ENABLED_KEY, [context.userId]);
    return { enabled: input.enabled };
  }),
});
