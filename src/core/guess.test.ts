import { describe, expect, it } from "vitest";
import { _selectNextHint, Word } from "./guess.js";
import { z } from "zod";
import { guessSchema } from "../utils/zoddy.js";

// Remember: words are sorted by similarity (closest first)
const TEST_WORDS: Word[] = [
  { word: "best", similarity: 0.95, is_hint: true, definition: "" }, // 0 hint
  { word: "better", similarity: 0.90, is_hint: false, definition: "" }, // 1 no
  { word: "good", similarity: 0.85, is_hint: true, definition: "" }, // 2 hint
  { word: "decent", similarity: 0.80, is_hint: false, definition: "" }, // 3 no
  { word: "ok", similarity: 0.75, is_hint: true, definition: "" }, // 4 hint
  { word: "meh", similarity: 0.70, is_hint: true, definition: "" }, // 5 hint
  { word: "bad", similarity: 0.65, is_hint: false, definition: "" }, // 6 no
  { word: "worse", similarity: 0.60, is_hint: true, definition: "" }, // 7 hint
  { word: "worst", similarity: 0.55, is_hint: false, definition: "" }, // 8 no
  { word: "terrible", similarity: 0.50, is_hint: true, definition: "" }, // 9 hint
];

export const makeGuess = (
  partialWord: Partial<z.infer<typeof guessSchema>> & { word: string },
): z.infer<typeof guessSchema> => {
  return {
    timestamp: Date.now(),
    similarity: 0.5,
    normalizedSimilarity: 0.5,
    isHint: false,
    rank: -1,
    ...partialWord,
  };
};

describe("selectNextHint", () => {
  it("should return the last available hint for first guess", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [],
    });

    expect(result).not.toBeNull();
    // Should return the furthest/last hint word (terrible)
    expect(result?.word).toBe("terrible");
  });

  it("should return the last available hint for first guess - previous guess outside of last N range", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [makeGuess({ word: "imnotevenrealbro", rank: 10000 })],
    });

    expect(result).not.toBeNull();
    // Should return the furthest/last hint word (terrible)
    expect(result?.word).toBe("terrible");
  });

  it("should return the last available hint for first guess - previous guess is not ranked", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [makeGuess({ word: "imnotevenrealbro", rank: -1 })],
    });

    expect(result).not.toBeNull();
    // Should return the furthest/last hint word (terrible)
    expect(result?.word).toBe("terrible");
  });

  it("from the last available hint, another hint should be halfway", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [
        makeGuess({ word: "imnotevenrealbro", rank: -1 }),
        makeGuess({ word: "terrible", rank: 9 }),
      ],
    });

    expect(result).not.toBeNull();
    // Should return the furthest/last hint word (terrible)
    expect(result?.word).toBe("ok");
  });

  it("should return hint at target index", () => {
    // User has guessed "terrible" (rank 9)
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [makeGuess({ word: "terrible", rank: 9 })],
    });

    expect(result).not.toBeNull();
    // Target is rank 9/2 = 4, where 'ok' is
    expect(result?.word).toBe("ok");
  });

  it("should return next hint closer to target when target is guessed", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [
        makeGuess({ word: "terrible", rank: 9 }),
        makeGuess({ word: "ok", rank: 4 }),
      ],
    });

    expect(result).not.toBeNull();
    // Already have rank 4 (ok), should get closest hint to target
    expect(result?.word).toBe("good");
  });

  it("should return previous guess if most similar has been guessed", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [
        makeGuess({ word: "best", rank: 0 }),
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.word).toBe("good");
  });

  it("should continue to return previous guesses until a unique one is found", () => {
    const result = _selectNextHint({
      similarWords: TEST_WORDS,
      previousGuesses: [
        makeGuess({ word: "best", rank: 0 }),
        makeGuess({ word: "good", rank: 2 }),
      ],
    });

    expect(result).not.toBeNull();
    expect(result?.word).toBe("ok");
  });
});

type Guess = z.infer<typeof guessSchema>;
