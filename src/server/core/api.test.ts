import { expect, vi } from 'vitest';
import { redis } from '@devvit/web/server';
import { test } from '../test';
import {
  WordConfigKey,
  buildHintCsvForChallenge,
  buildLetterCsvForChallenge,
  getWord,
} from './api';

test('buildLetterCsvForChallenge serves the full ranked list and secret from static caches', async () => {
  await redis.set(
    WordConfigKey('apple'),
    JSON.stringify({
      closest_word: 'apex',
      closest_similarity: 0.75,
      furthest_word: 'zebra',
      furthest_similarity: 0.1,
      similar_words: [
        { word: 'apex', similarity: 0.75, is_hint: true },
        { word: 'apricot', similarity: 0.65, is_hint: false },
        { word: 'banana', similarity: 0.55, is_hint: true },
      ],
    })
  );
  await expect(
    buildLetterCsvForChallenge({
      challengeSecretWord: 'apple',
      letter: 'a',
    })
  ).resolves.toBe(
    ['word,similarity,rank', 'apex,0.7500,1', 'apple,1.0000,0', 'apricot,0.6500,2'].join('\n')
  );
});

test('buildHintCsvForChallenge returns only static hint rows with global ranks', async () => {
  await redis.set(
    WordConfigKey('banana'),
    JSON.stringify({
      closest_word: 'plantain',
      closest_similarity: 0.82,
      furthest_word: 'smoothie',
      furthest_similarity: 0.3,
      similar_words: [
        { word: 'plantain', similarity: 0.82, is_hint: true },
        { word: 'yellow', similarity: 0.5, is_hint: false },
        { word: 'fruit', similarity: 0.48, is_hint: true },
        { word: 'smoothie', similarity: 0.3, is_hint: true },
      ],
    })
  );

  await expect(buildHintCsvForChallenge({ challengeSecretWord: 'banana', max: 2 })).resolves.toBe(
    ['word,similarity,rank', 'plantain,0.8200,1', 'fruit,0.4800,3'].join('\n')
  );
});

test('getWord treats a missing static target file as an invalid future puzzle', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(getWord({ word: 'missing-static-target-test' })).resolves.toEqual({ data: [] });
  } finally {
    vi.unstubAllGlobals();
  }
});

test('getWord does not mistake a static host failure for an invalid target', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(getWord({ word: 'unavailable-static-target-test' })).rejects.toThrow('HTTP 503');
  } finally {
    vi.unstubAllGlobals();
  }
});
