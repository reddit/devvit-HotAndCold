import { firstOfTargetHeatHelper, heatStreakHelper } from './feedback.js';

it('firstOfTargetHeatHelper - false', () => {
  expect(firstOfTargetHeatHelper({ guesses: [], target: 'COLD' })).toBe(false);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(false);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 50,
          rank: 1001,
          similarity: 0.5,
          timestamp: Date.now(),
          word: 'test1',
        },
      ],
      target: 'COLD',
    })
  ).toBe(false);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 50,
          rank: 1001,
          similarity: 0.5,
          timestamp: Date.now(),
          word: 'test1',
        },
      ],
      target: 'COLD',
    })
  ).toBe(false);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 50,
          rank: 1001,
          similarity: 0.5,
          timestamp: Date.now(),
          word: 'test1',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(false);
});

it('firstOfTargetHeatHelper - true', () => {
  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1001,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test1',
        },
      ],
      target: 'COLD',
    })
  ).toBe(true);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 50,
          rank: 1001,
          similarity: 0.5,
          timestamp: Date.now(),
          word: 'test1',
        },
      ],
      target: 'WARM',
    })
  ).toBe(true);

  expect(
    firstOfTargetHeatHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 50,
          rank: 1001,
          similarity: 0.5,
          timestamp: Date.now(),
          word: 'test1',
        },
        {
          heat: 'HOT',
          isHint: false,
          normalizedSimilarity: 80,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'HOT',
    })
  ).toBe(true);
});

it('heatStreakHelper', () => {
  expect(heatStreakHelper({ guesses: [], target: 'COLD' })).toBe(0);
  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(1);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(1);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(1);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(2);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(0);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(1);

  expect(
    heatStreakHelper({
      guesses: [
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'WARM',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
        {
          heat: 'COLD',
          isHint: false,
          normalizedSimilarity: 10,
          rank: 1000,
          similarity: 0.1,
          timestamp: Date.now(),
          word: 'test',
        },
      ],
      target: 'COLD',
    })
  ).toBe(2);
});
