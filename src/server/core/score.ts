import { z } from 'zod';

export namespace Score {
  export const Info = z.object({
    version: z.string(),
    finalScore: z.number(),
    breakdown: z.object({
      solvingBonus: z.number(),
      timeBonus: z.object({
        points: z.number(),
        timeInSeconds: z.number(),
        isOptimal: z.boolean(),
      }),
      guessBonus: z.object({
        points: z.number(),
        numberOfGuesses: z.number(),
        isOptimal: z.boolean(),
      }),
      hintPenalty: z.object({
        numberOfHints: z.number(),
        penaltyMultiplier: z.number(),
      }),
    }),
  });

  export type ScoreExplanation = z.infer<typeof Info>;

  export function calculateScore({
    solveTimeMs,
    totalHints,
    totalGuesses,
  }: {
    solveTimeMs: number;
    totalHints: number;
    /** Inclusive of hints! */
    totalGuesses: number;
  }): ScoreExplanation {
    // Solving bonus (flat 10 points for completing)
    const solvingBonus = 10;

    // Time bonus calculation
    const timeInSeconds = solveTimeMs / 1000;
    let timeBonus;
    const isOptimalTime = timeInSeconds <= 30;
    if (isOptimalTime) {
      timeBonus = 40;
    } else if (timeInSeconds <= 600) {
      // 10 minutes
      // Only start from 39 otherwise at 35 seconds you could still get a perfect score due to rounding
      timeBonus = Math.round(39 * (1 - (timeInSeconds - 30) / 570));
    } else {
      timeBonus = 0;
    }

    let guessBonus;
    const isOptimalGuesses = totalGuesses <= 15;
    if (isOptimalGuesses) {
      guessBonus = 50;
    } else if (totalGuesses <= 100) {
      // Meanwhile, this can start at 50 because another guess is enough to deduct 1 point
      guessBonus = Math.round(50 * (1 - (totalGuesses - 15) / 85));
    } else {
      guessBonus = 0;
    }

    // Calculate base score
    const baseScore = solvingBonus + timeBonus + guessBonus;

    const penaltyMultiplier = Math.pow(0.7, totalHints);
    const finalScore = Math.round(baseScore * penaltyMultiplier);

    return {
      version: '1',
      finalScore,
      breakdown: {
        solvingBonus,
        timeBonus: {
          points: timeBonus,
          timeInSeconds,
          isOptimal: isOptimalTime,
        },
        guessBonus: {
          points: guessBonus,
          numberOfGuesses: totalGuesses,
          isOptimal: isOptimalGuesses,
        },
        hintPenalty: {
          numberOfHints: totalHints,
          penaltyMultiplier,
        },
      },
    };
  }
}
