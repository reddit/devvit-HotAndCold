import { expect, it } from 'vitest';
import { selectNextHint, type HintWord } from './hints';
const hint = (word: string, rank: number, similarity = 0.5): HintWord => ({
  word,
  rank,
  similarity,
  isHint: true,
});
it('uses actual sparse ranks to pick a genuinely closer hint near half the best rank', () => {
  expect(
    selectNextHint({
      hintWords: [hint('near', 90), hint('middle', 180), hint('far', 5000)],
      previousGuesses: [{ word: 'guess', rank: 200 }],
    })?.word
  ).toBe('near');
});
it('skips guessed words and the answer rather than revealing it as a hint', () => {
  expect(
    selectNextHint({
      hintWords: [hint('answer', 1, 1), hint('USED', 50), hint('fresh', 80)],
      previousGuesses: [
        { word: 'used', rank: 50 },
        { word: 'guess', rank: 200 },
      ],
    })
  ).toBeNull();
});
it('returns no hint when every unused candidate is farther away', () => {
  expect(
    selectNextHint({ hintWords: [hint('far', 200)], previousGuesses: [{ word: 'close', rank: 5 }] })
  ).toBeNull();
});
it('starts with the gentlest available hint when all guesses are unranked', () => {
  expect(
    selectNextHint({
      hintWords: [hint('close', 10), hint('gentle', 1000)],
      previousGuesses: [{ word: 'unknown', rank: -1 }],
    })?.word
  ).toBe('gentle');
});
