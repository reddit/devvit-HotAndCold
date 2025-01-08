import { Guess } from "../../game/shared.js";

// TODO: Keep in sync with guesses.tsx where users see it while playing
export const getHeatForGuess = (item: Guess) => {
  if (item.normalizedSimilarity < 40) {
    return "COLD" as const;
  }
  if (
    item.normalizedSimilarity >= 40 &&
    item.normalizedSimilarity < 80
  ) {
    return "WARM" as const;
  }
  if (item.normalizedSimilarity >= 80) {
    return "HOT" as const;
  }

  throw new Error(`Out of bounds heat: ${item.normalizedSimilarity}`);
};
