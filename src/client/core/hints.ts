import { fetcher } from '../utils/fetcher';
import { createLocalStorageSignal } from '../utils/localStorageSignal';

export type HintWord = {
  word: string;
  similarity: number;
  rank: number; // 0 is closest to the target
  isHint: true;
};

export type PreviousGuess = {
  word: string;
  rank: number; // -1 when unknown; larger means further
};

/** Load and parse the `_hint.csv` for a given challenge. */
export async function loadHintsForChallenge(challengeNumber: number): Promise<HintWord[]> {
  const csv = await fetcher.request<string>(`/challenges/${String(challengeNumber)}/_hint.csv`, {
    timeout: 5000,
    maxAttempts: 3,
  });
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

/**
 * Select the next hint using the same "weird" logic used previously on the server.
 * Ported from server/core/userGuess._selectNextHint.
 */
export function selectNextHint(params: {
  hintWords: HintWord[];
  previousGuesses: PreviousGuess[];
}): HintWord | null {
  const { hintWords, previousGuesses } = params;
  const words = hintWords.slice(0, 250);
  const guessed = new Set(previousGuesses.map((g) => g.word));

  const findNextHint = (
    startIndex: number,
    endIndex: number,
    searchForward: boolean
  ): HintWord | null => {
    const indices = searchForward
      ? Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i)
      : Array.from({ length: startIndex + 1 }, (_, i) => startIndex - i);
    for (const i of indices) {
      const w = words[i];
      if (w && !guessed.has(w.word)) return w;
    }
    return null;
  };

  if (previousGuesses.length === 0) {
    return findNextHint(words.length - 1, 0, false);
  }

  const validGuesses = previousGuesses.filter((g) => g.rank >= 0);
  if (validGuesses.length === 0) {
    return findNextHint(words.length - 1, 0, false);
  }

  const closestIndex = Math.min(...validGuesses.map((g) => g.rank));

  if (closestIndex === 0) {
    return findNextHint(1, words.length - 1, true);
  }

  const targetIndex = Math.floor(closestIndex / 2);
  const forwardHint = findNextHint(targetIndex, closestIndex, true);
  if (forwardHint) return forwardHint;
  const backwardHint = findNextHint(targetIndex - 1, 0, false);
  if (backwardHint) return backwardHint;
  return findNextHint(closestIndex + 1, words.length - 1, true);
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
