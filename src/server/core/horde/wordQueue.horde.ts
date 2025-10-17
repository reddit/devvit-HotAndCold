import { z } from 'zod';
import { fn } from '../../../shared/fn';
import { redis } from '@devvit/web/server';

export namespace HordeWordQueue {
  export const Key = () => `horde:word_queue` as const;

  // Minimal challenge shape used by the queue.
  export const ChallengeSchema = z.object({ words: z.array(z.string().min(1)).min(1) }).strict();

  export type Challenge = z.infer<typeof ChallengeSchema>;

  const assertValidChallenge = (challenge: unknown): Challenge => {
    const parsed = ChallengeSchema.safeParse(challenge);
    if (!parsed.success) {
      throw new Error('Invalid challenge');
    }
    return parsed.data;
  };

  export const append = fn(z.object({ challenge: ChallengeSchema }), async ({ challenge }) => {
    const valid = assertValidChallenge(challenge);
    const score = Date.now();
    await redis.zAdd(Key(), { score, member: JSON.stringify(valid) });
  });

  export const prepend = fn(z.object({ challenge: ChallengeSchema }), async ({ challenge }) => {
    const valid = assertValidChallenge(challenge);
    // Ensure FIFO ordering by using a score strictly smaller than the current minimum.
    const min = await redis.zRange(Key(), 0, 0, { by: 'rank' });
    const smallest = min[0]?.score ?? Date.now();
    const score = smallest - 1;
    await redis.zAdd(Key(), { score, member: JSON.stringify(valid) });
  });

  export const shift = fn(z.void(), async () => {
    const result = await redis.zRange(Key(), 0, 0, { by: 'rank' });
    if (result.length === 0) return null as Challenge | null;
    const first = result[0];
    if (!first) return null as Challenge | null;
    const parsed = JSON.parse(first.member);
    const valid = assertValidChallenge(parsed);
    await redis.zRem(Key(), [first.member]);
    return valid;
  });

  export const overwrite = fn(
    z.object({ challenges: z.array(ChallengeSchema) }),
    async ({ challenges }) => {
      const validated = challenges.map((c) => assertValidChallenge(c));
      await redis.del(Key());
      const base = Date.now();
      for (let i = 0; i < validated.length; i++) {
        const c = validated[i]!;
        await redis.zAdd(Key(), { score: base + i, member: JSON.stringify(c) });
      }
    }
  );

  export const clear = fn(z.void(), async () => {
    await redis.del(Key());
  });

  export const size = fn(z.void(), async () => {
    return await redis.zCard(Key());
  });

  export const peekAll = fn(z.void(), async () => {
    const items = await redis.zRange(Key(), 0, -1, { by: 'rank' });
    return items.map((i) => assertValidChallenge(JSON.parse(i.member)));
  });
}
