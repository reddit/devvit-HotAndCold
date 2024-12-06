import { describe, expect, it } from "vitest";
import {
  _computeProgress,
  _selectNextHint,
  guessSchema,
  Word,
} from "./guess.js";
import { z } from "zod";

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

describe("_computeProgress", () => {
  it("returns the guess's similarity if only one guess is present", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 50, isHint: false, word: "test" }),
    ];

    // Average of [50] = 50
    const result = _computeProgress(previousGuesses, 5);
    expect(result).toBe(50);
  });

  it("filters out hints from previous guesses", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 10, isHint: false, word: "apple" }),
      makeGuess({ normalizedSimilarity: 99, isHint: true, word: "hinty" }),
      makeGuess({ normalizedSimilarity: 20, isHint: false, word: "banana" }),
      // 'new' guess
      makeGuess({ normalizedSimilarity: 15, isHint: false, word: "cherry" }),
    ];

    // windowSize = 3
    // Non-hint guesses: apple(10), banana(20), cherry(15)
    // Average = (10 + 20 + 15) / 3 = 45/3 = 15
    const result = _computeProgress(previousGuesses, 3);
    expect(result).toBe(15);
  });

  it("handles a larger windowSize than the number of previous guesses", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 10, isHint: false, word: "first" }),
      // 'new' guess
      makeGuess({ normalizedSimilarity: 30, isHint: false, word: "second" }),
    ];

    // windowSize = 10, non-hint: first(10), second(30)
    // Average = (10 + 30)/2 = 40/2 = 20
    const result = _computeProgress(previousGuesses, 10);
    expect(result).toBe(20);
  });

  it("considers only the last `windowSize` non-hint guesses, including the new one", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 5, isHint: false, word: "g1" }),
      makeGuess({ normalizedSimilarity: 10, isHint: false, word: "g2" }),
      makeGuess({ normalizedSimilarity: 15, isHint: false, word: "g3" }),
      makeGuess({ normalizedSimilarity: 40, isHint: false, word: "g4" }),
      // New guess
      makeGuess({ normalizedSimilarity: 20, isHint: false, word: "g5" }),
    ];

    // windowSize = 3
    // Last 3 non-hint: g3(15), g4(40), g5(20)
    // Average = (15 + 40 + 20)/3 = 75/3 = 25
    const result = _computeProgress(previousGuesses, 3);
    expect(result).toBe(25);
  });

  it("handles cases where all previous guesses are hints except the new one", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 10, isHint: true, word: "hint1" }),
      makeGuess({ normalizedSimilarity: 20, isHint: true, word: "hint2" }),
      // New guess is non-hint
      makeGuess({ normalizedSimilarity: 15, isHint: false, word: "final" }),
    ];

    // Only one non-hint guess: final(15)
    // Average = 15
    const result = _computeProgress(previousGuesses, 3);
    expect(result).toBe(15);
  });

  it("handles scenario with windowSize = 1", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 10, isHint: false, word: "old1" }),
      makeGuess({ normalizedSimilarity: 20, isHint: false, word: "old2" }),
      // New guess
      makeGuess({ normalizedSimilarity: 100, isHint: false, word: "new" }),
    ];

    // windowSize = 1 means only the last non-hint guess: new(100)
    // Average = 100
    const result = _computeProgress(previousGuesses, 1);
    expect(result).toBe(100);
  });

  it("returns 0 if no non-hint guesses exist at all", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 10, isHint: true, word: "hint1" }),
      makeGuess({ normalizedSimilarity: 20, isHint: true, word: "hint2" }),
      makeGuess({ normalizedSimilarity: 30, isHint: true, word: "hint3" }),
    ];

    // No non-hint guesses, return 0
    const result = _computeProgress(previousGuesses, 3);
    expect(result).toBe(0);
  });

  it("handles extreme values of normalizedSimilarity", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 0, isHint: false, word: "low" }),
      // New guess
      makeGuess({ normalizedSimilarity: 100, isHint: false, word: "high" }),
    ];

    // Average = (0 + 100)/2 = 50
    const result = _computeProgress(previousGuesses, 5);
    expect(result).toBe(50);
  });

  it("handles an empty array of guesses by returning 0", () => {
    const previousGuesses: Guess[] = [];
    // No guesses means no non-hint guesses
    // Return 0
    const result = _computeProgress(previousGuesses, 10);
    expect(result).toBe(0);
  });

  it("ignores hints when computing the average", () => {
    const previousGuesses: Guess[] = [
      makeGuess({ normalizedSimilarity: 5, isHint: false, word: "real1" }),
      makeGuess({ normalizedSimilarity: 99, isHint: true, word: "hint" }),
      makeGuess({ normalizedSimilarity: 10, isHint: false, word: "real2" }),
      // New guess
      makeGuess({ normalizedSimilarity: 20, isHint: false, word: "real3" }),
    ];

    // windowSize = 3
    // Non-hint: real1(5), real2(10), real3(20)
    // Average = (5 + 10 + 20)/3 = 35/3 = ~11.67 -> round = 12
    const result = _computeProgress(previousGuesses, 3);
    expect(result).toBe(12);
  });
});
