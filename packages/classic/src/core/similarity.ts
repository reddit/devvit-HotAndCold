import { z } from 'zod';
import { zoddy } from '@hotandcold/shared/utils/zoddy';

export * as Similarity from './similarity.js';

export const normalizeSimilarity = zoddy(
  z.object({
    closestWordSimilarity: z.number(),
    furthestWordSimilarity: z.number(),
    targetWordSimilarity: z.number(),
    steepness: z.number().optional(),
    midpoint: z.number().optional(),
    usePower: z.boolean().optional(),
    powerFactor: z.number().optional(),
  }),
  ({
    closestWordSimilarity,
    furthestWordSimilarity,
    targetWordSimilarity,
    midpoint = 0.55,
    powerFactor = 1.5,
    steepness = 15,
    usePower = false,
  }) => {
    // Handle edge cases
    if (closestWordSimilarity === furthestWordSimilarity) {
      return targetWordSimilarity >= closestWordSimilarity ? 100 : 0;
    }

    // Calculate the base normalized score
    const normalizedScore =
      (targetWordSimilarity - furthestWordSimilarity) /
      (closestWordSimilarity - furthestWordSimilarity);

    // Apply optional power transformation
    const transformedScore = usePower ? Math.pow(normalizedScore, powerFactor) : normalizedScore;

    // Apply sigmoid transformation
    const finalScore = 100 / (1 + Math.exp(-steepness * (transformedScore - midpoint)));

    // Clamp the result between 0 and 99
    return Math.max(0, Math.min(99, Math.round(finalScore)));
  }
);
