// Progress calculation based on rank within a dictionary of up to 100,000 words.
// The mapping follows these rules:
// - Rank > 1000 maps to the 0%..10% range (worse ranks trend toward 0%).
// - Rank in [1..1000] maps to the 10%..100% range (closer ranks trend toward 100%).
// - Rank 0 is the secret word and maps to 100%.
// - Rank < 0 or rank > totalWords maps to 0%.

export type RankToProgressOptions = {
  totalWords?: number; // default 25_000
};

export function rankToProgress(rank: number, opts: RankToProgressOptions = {}): number {
  const totalWords = Math.max(1_000, Math.floor(opts.totalWords ?? 25_000));

  if (!Number.isFinite(rank)) return 0;
  const r = Math.floor(rank);

  if (r < 0) return 0;
  if (r === 0) return 100;
  if (r > totalWords) return 0;

  // High ranks: [1001 .. totalWords] → [~10% .. 0%]
  if (r > 1000) {
    const denom = totalWords - 1000;
    if (denom <= 0) return 0;
    const fraction = (totalWords - r) / denom; // 1001 → ~1, totalWords → 0
    const pct = 10 * Math.max(0, Math.min(1, fraction));
    return pct;
  }

  // Close ranks: [1 .. 1000] → (10% .. 100%]
  const fraction = (1000 - r) / 1000; // 1 → 0.999, 1000 → 0
  const pct = 10 + 90 * Math.max(0, Math.min(1, fraction));
  return pct;
}
