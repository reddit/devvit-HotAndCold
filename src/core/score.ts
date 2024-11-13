export * as Score from "./score";

export function calculateScore(
  { solveTime, totalGuesses, guesses }: {
    solveTime: number;
    totalGuesses: number;
    guesses: { member: string; score: number }[];
  },
): number {
  if (!gameEnded) return 0; // Only give points for solving the puzzle

  // Base time bonus (max 400 points)
  // Full 400 points if solved within 30 seconds
  // Decreases linearly until 5 minutes (300 seconds), then minimal points
  const timeInSeconds = (Date.now() - startTime) / 1000;
  let timeBonus;
  if (timeInSeconds <= 30) {
    timeBonus = 400; // Perfect time bonus
  } else if (timeInSeconds <= 300) {
    timeBonus = Math.round(400 * (1 - (timeInSeconds - 30) / 270)); // Linear decrease
  } else {
    timeBonus = 50; // Minimum time bonus
  }

  // Guess efficiency bonus (max 400 points)
  // Full 400 points for solving in 1-3 guesses
  // Decreases with more guesses
  let guessBonus;
  const numGuesses = guessHistory.length;
  if (numGuesses <= 3) {
    guessBonus = 400; // Perfect guess bonus
  } else if (numGuesses <= 10) {
    guessBonus = Math.round(400 * (1 - (numGuesses - 3) / 7)); // Linear decrease until 10 guesses
  } else {
    guessBonus = Math.max(50, Math.round(400 * Math.pow(0.9, numGuesses - 10))); // Exponential decrease after 10 guesses
  }

  // Average heat bonus (max 200 points)
  // Rewards players who made "hot" guesses throughout
  const avgHeat = guessHistory.reduce((acc, curr) => acc + curr.score, 0) /
    numGuesses;
  const heatBonus = Math.round((avgHeat / 100) * 200);

  // Hint penalty
  // Each hint divides the final score by 1.5
  let finalScore = timeBonus + guessBonus + heatBonus;
  for (let i = 0; i < hintsUsed; i++) {
    finalScore = Math.round(finalScore / 1.5);
  }

  // Ensure score is between 0 and 1000
  return Math.min(1000, Math.max(0, finalScore));
}
