export type GuessHeat = 0 | 1 | 2;

// Keep the soundtrack milestones aligned with the emojis shown beside guesses.
export function guessHeat(rank?: number | null): GuessHeat {
  if (rank == null || !Number.isFinite(rank) || rank < 1) return 0;
  if (rank <= 250) return 2;
  if (rank <= 1000) return 1;
  return 0;
}

export function getRankEmoji(rank?: number | null): string | null {
  return [null, '☀️', '🔥'][guessHeat(rank)] ?? null;
}

export function bestGuessHeat(guesses: ReadonlyArray<{ rank: number }>): GuessHeat {
  return guesses.reduce<GuessHeat>(
    (best, guess) => Math.max(best, guessHeat(guess.rank)) as GuessHeat,
    0
  );
}
