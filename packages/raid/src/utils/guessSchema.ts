import { z } from 'zod';

export const guessSchema = z
  .object({
    word: z.string(),
    similarity: z.number().gte(-1).lte(1),
    normalizedSimilarity: z.number().gte(0).lte(100),
    timestamp: z.number(),
    // Only for top 1,000 similar words
    rank: z.number().gte(-1),
    username: z.string().optional(),
    snoovatar: z.string().optional(),
  })
  .strict();
