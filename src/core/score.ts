import { z } from "zod";
import { guessSchema } from "./guess.js";

export * as Score from "./score.js";

export const scoreSchema = z.object({
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

export type ScoreExplanation = z.infer<typeof scoreSchema>;

export function calculateScore(
  { solveTimeMs, totalHints, guesses }: {
    solveTimeMs: number;
    totalHints: number;
    guesses: z.infer<typeof guessSchema>[];
  },
): ScoreExplanation {
  // Solving bonus (flat 10 points for completing)
  const solvingBonus = 10;

  // Time bonus calculation
  const timeInSeconds = solveTimeMs / 1000;
  let timeBonus;
  const isOptimalTime = timeInSeconds <= 30;
  if (isOptimalTime) {
    timeBonus = 40;
  } else if (timeInSeconds <= 600) { // 10 minutes
    timeBonus = Math.round(40 * (1 - (timeInSeconds - 30) / 570));
  } else {
    timeBonus = 0;
  }

  const numGuesses = guesses.length;
  let guessBonus;
  const isOptimalGuesses = numGuesses <= 15;
  if (isOptimalGuesses) {
    guessBonus = 50;
  } else if (numGuesses <= 100) {
    guessBonus = Math.round(50 * (1 - (numGuesses - 15) / 85));
  } else {
    guessBonus = 0;
  }

  // Calculate base score
  let baseScore = solvingBonus + timeBonus + guessBonus;

  const penaltyMultiplier = Math.pow(0.85, totalHints);
  const finalScore = Math.round(baseScore * penaltyMultiplier);

  return {
    version: "1",
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
        numberOfGuesses: numGuesses,
        isOptimal: isOptimalGuesses,
      },
      hintPenalty: {
        numberOfHints: totalHints,
        penaltyMultiplier,
      },
    },
  };
}
