import { WORD_DATA_API_PREFIX } from '../../shared/wordDataVersion';
import { fetcher } from '../utils/fetcher';
import { createLocalStorageSignal } from '../utils/localStorageSignal';

export type HintWord = {
  word: string;
  similarity: number;
  rank: number; // 1-based global rank, as supplied by the hint CSV
  isHint: true;
};

export type PreviousGuess = {
  word: string;
  rank: number; // -1 when unknown; larger means further
};

/** Load and parse the `_hint.csv` for a given challenge. */
export async function loadHintsForChallenge(challengeNumber: number): Promise<HintWord[]> {
  const csv = await fetcher.request<string>(
    `${WORD_DATA_API_PREFIX}/challenges/${String(challengeNumber)}/_hint.csv`,
    {
      timeout: 15000,
      maxAttempts: 3,
    }
  );
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const out: HintWord[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line.toLowerCase().startsWith('word,')) continue; // header
    const [wordRaw, simStr, rankStr] = line.split(',');
    if (!wordRaw || !simStr) continue;
    const word = wordRaw.trim().toLowerCase();
    const similarity = Number.parseFloat(simStr);
    const rank = rankStr ? Number.parseInt(rankStr, 10) : i - 1; // fallback to order if missing
    if (!Number.isFinite(similarity)) continue;
    out.push({ word, similarity, rank: Number.isFinite(rank) ? rank : i - 1, isHint: true });
  }
  return out;
}

/** Choose an unused, genuinely closer hint using ranks, not CSV array positions. */
export function selectNextHint({
  hintWords,
  previousGuesses,
}: {
  hintWords: HintWord[];
  previousGuesses: PreviousGuess[];
}): HintWord | null {
  const guessed = new Set(previousGuesses.map((guess) => guess.word.toLowerCase()));
  const available = hintWords
    .slice(0, 250)
    .filter(
      (hint) =>
        Number.isFinite(hint.rank) &&
        hint.rank > 0 &&
        hint.similarity < 1 &&
        !guessed.has(hint.word.toLowerCase())
    );
  const ranks = previousGuesses
    .map((guess) => guess.rank)
    .filter((rank) => Number.isFinite(rank) && rank >= 0);
  if (!ranks.length)
    return available.reduce<HintWord | null>(
      (furthest, hint) => (!furthest || hint.rank > furthest.rank ? hint : furthest),
      null
    );
  const bestRank = Math.min(...ranks);
  const target = Math.max(1, Math.floor(bestRank / 2));
  return available
    .filter((hint) => hint.rank < bestRank)
    .reduce<HintWord | null>(
      (best, hint) =>
        !best || Math.abs(hint.rank - target) < Math.abs(best.rank - target) ? hint : best,
      null
    );
}

/** Convenience: read previously guessed history (ranks) from storage. */
export function loadPreviousGuessesFromSession(challengeNumber: number): PreviousGuess[] {
  if (typeof window === 'undefined') return [];
  const key = `guess-history:${String(challengeNumber)}`;
  const { signal, dispose } = createLocalStorageSignal<Array<{ word: string; rank: number }>>({
    key,
    initialValue: [],
  });
  const items = Array.isArray(signal.value) ? signal.value : [];
  dispose();
  return items.map((i) => ({ word: String(i.word).toLowerCase(), rank: Number(i.rank ?? -1) }));
}
