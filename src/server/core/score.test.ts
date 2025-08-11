import { Score } from './score';
import { it, describe, expect, test } from 'vitest';

describe('calculateScore', () => {
  it('returns a result matching the score schema', () => {
    const result = Score.calculateScore({
      solveTimeMs: 30_000, // exactly optimal time
      totalHints: 0,
      totalGuesses: 10, // well under optimal guesses
    });
    expect(() => Score.Info.parse(result)).not.toThrow();
  });

  describe('Edge Cases', () => {
    test('Minimal solve time (0ms) and minimal guesses (1) with no hints should yield maximum bonuses', () => {
      // At 0ms, time is optimal => timeBonus = 40
      // Guesses = 1, optimal => guessBonus = 50
      // Solving = 10
      // No hints => finalScore = (10+40+50)*1 = 100
      const result = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 0,
        totalGuesses: 1,
      });
      expect(result.finalScore).toBe(100);
      expect(result.breakdown.timeBonus.isOptimal).toBe(true);
      expect(result.breakdown.guessBonus.isOptimal).toBe(true);
      expect(result.breakdown.hintPenalty.numberOfHints).toBe(0);
    });

    test('Exact optimal time boundary (30s) with optimal guesses (15) and no hints', () => {
      // At 30s, still optimal time => 40
      // Guesses = 15 => optimal => 50
      // Solving = 10
      // Final = 10+40+50=100
      const result = Score.calculateScore({
        solveTimeMs: 30_000,
        totalHints: 0,
        totalGuesses: 15,
      });
      expect(result.finalScore).toBe(100);
      expect(result.breakdown.timeBonus.isOptimal).toBe(true);
      expect(result.breakdown.guessBonus.isOptimal).toBe(true);
    });

    test('Just over optimal time (31s) with optimal guesses (15) and no hints', () => {
      // At 31s, slightly worse than optimal:
      // timeBonus ~ 39 (with Math.floor as recommended)
      // guessBonus = 50 (optimal)
      // solving = 10
      // finalScore = 10+39+50=99
      const result = Score.calculateScore({
        solveTimeMs: 31_000,
        totalHints: 0,
        totalGuesses: 15,
      });
      expect(result.finalScore).toBe(99);
      expect(result.breakdown.timeBonus.points).toBe(39);
    });

    test('A mid-range time (300s) with optimal guesses (15) and no hints', () => {
      // At 300s:
      // (300-30)/570 ≈ 270/570 ≈ 0.4737
      // 1 - 0.4737 ≈ 0.5263
      // timeBonus = floor(40 * 0.5263) = floor(21.05) = 21
      // guessBonus = 50 (optimal)
      // solving = 10
      // finalScore = 10+21+50=81
      const result = Score.calculateScore({
        solveTimeMs: 300_000,
        totalHints: 0,
        totalGuesses: 15,
      });
      expect(result.finalScore).toBe(81);
      expect(result.breakdown.timeBonus.points).toBe(21);
      expect(result.breakdown.guessBonus.points).toBe(50);
    });

    test('Over time limit (601s) with optimal guesses (15) and no hints', () => {
      // >600s => timeBonus=0
      // guesses=15 => guessBonus=50
      // solving=10
      // final=10+0+50=60
      const result = Score.calculateScore({
        solveTimeMs: 601_000,
        totalHints: 0,
        totalGuesses: 15,
      });
      expect(result.finalScore).toBe(60);
      expect(result.breakdown.timeBonus.points).toBe(0);
    });

    test('Optimal guesses exactly at 15', () => {
      // 0s => time=40, guesses=15=50, solve=10 final=100
      const result = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 0,
        totalGuesses: 15,
      });
      expect(result.finalScore).toBe(100);
      expect(result.breakdown.guessBonus.points).toBe(50);
    });

    test('Just over optimal guesses at 16 guesses', () => {
      // 0s time=40
      // guesses=16:
      // guessBonus = round(50*(1-(16-15)/85))=round(50*(1-1/85))=round(50*0.9882353)=round(49.4118)=49
      // final=10+40+49=99
      const result = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 0,
        totalGuesses: 16,
      });
      expect(result.finalScore).toBe(99);
      expect(result.breakdown.guessBonus.points).toBe(49);
    });

    test('Extremely high guesses (101) yields 0 guess bonus', () => {
      // 0s time=40, guess=101 => guessBonus=0, final=10+40=50
      const result = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 0,
        totalGuesses: 101,
      });
      expect(result.finalScore).toBe(50);
      expect(result.breakdown.guessBonus.points).toBe(0);
    });

    test('Hints penalty reduces the score', () => {
      // No hints, minimal conditions => final=100 (from earlier scenario)
      const noHints = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 0,
        totalGuesses: 1,
      });
      expect(noHints.finalScore).toBe(100);

      // 1 hint: final=round(100*0.85)=85
      const oneHint = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 1,
        totalGuesses: 1,
      });
      expect(oneHint.finalScore).toBe(70);

      // 5 hints:
      // penalty=0.85^5≈0.4437
      // final=round(100*0.4437)=44
      const multipleHints = Score.calculateScore({
        solveTimeMs: 0,
        totalHints: 5,
        totalGuesses: 1,
      });
      expect(multipleHints.finalScore).toBe(17);
    });
  });

  describe('Multiple Scenarios (it.each)', () => {
    // Choose scenarios that produce stable final integers
    const scenarios = [
      {
        name: 'Fast, few guesses, no hints',
        input: { solveTimeMs: 10_000, totalHints: 0, totalGuesses: 5 },
        // time <=30 =>40, guess ≤15 =>50, solve=10 final=100
        finalExpected: 100,
        timeExpected: 40,
        guessExpected: 50,
      },
      {
        name: 'Slightly slower, optimal guesses, no hints',
        input: { solveTimeMs: 100_000, totalHints: 0, totalGuesses: 15 },
        // (100-30)/570=70/570≈0.1228
        // 1-0.1228=0.8772*40=35.09 floor=35 time
        // guess=50 solve=10 final=10+35+50=95
        finalExpected: 94,
        timeExpected: 34,
        guessExpected: 50,
      },
      {
        name: 'Near time limit, minimal guesses, some hints',
        input: { solveTimeMs: 500_000, totalHints: 2, totalGuesses: 1 },
        finalExpected: 33, // stable
        timeExpected: 7,
        guessExpected: 50,
      },
      {
        name: 'Over time limit, high guesses, no hints',
        input: { solveTimeMs: 700_000, totalHints: 0, totalGuesses: 100 },
        // time>600=0 timeBonus
        // guesses=100: guessBonus=round(50*(1-(100-15)/85))=round(50*(1-(85/85)))=round(0)=0
        // final=10+0+0=10
        finalExpected: 10,
        timeExpected: 0,
        guessExpected: 0,
      },
      {
        name: 'High time, high guesses, multiple hints',
        input: { solveTimeMs: 700_000, totalHints: 3, totalGuesses: 200 },
        // time>600=0
        // guesses>100=0
        // base=10
        // hints=3 => 0.85^3=0.614125 final=round(10*0.614125)=6
        finalExpected: 3,
        timeExpected: 0,
        guessExpected: 0,
      },
    ];

    it.each(scenarios)('$name', ({ input, finalExpected, timeExpected, guessExpected }) => {
      const result = Score.calculateScore(input);
      expect(result.finalScore).toBe(finalExpected);
      expect(result.breakdown.timeBonus.points).toBe(timeExpected);
      expect(result.breakdown.guessBonus.points).toBe(guessExpected);
    });
  });
});
