import { z } from "zod";
import { zoddy } from "../utils/zoddy.js";

export * as Similarity from "./similarity.js";

export const normalizeSimilarity = zoddy(
  z.object({
    closestWordSimilarity: z.number(),
    furthestWordSimilarity: z.number(),
    targetWordSimilarity: z.number(),
  }),
  ({ closestWordSimilarity, furthestWordSimilarity, targetWordSimilarity }) => {
    // Handle edge cases
    if (closestWordSimilarity === furthestWordSimilarity) {
      return targetWordSimilarity >= closestWordSimilarity ? 100 : 0;
    }

    // Calculate the normalized score
    const normalizedScore = Math.round(
      ((targetWordSimilarity - furthestWordSimilarity) /
        (closestWordSimilarity - furthestWordSimilarity)) * 100,
    );

    // Clamp the result between 0 and 100
    return Math.max(0, Math.min(100, normalizedScore));
  },
);
