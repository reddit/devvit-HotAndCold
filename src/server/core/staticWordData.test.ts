import { gzipSync } from 'node:zlib';
import { expect, vi } from 'vitest';
import { test } from '../test';
import {
  STATIC_WORD_DATA_BASE_URL,
  decodeStaticDictionary,
  decodeStaticWordConfig,
  getStaticWordConfig,
} from './staticWordData';

function makeDictionary() {
  const bytes = gzipSync(
    ['id,word,isHint', '0,apple,false', '1,apex,true', '2,banana,false', '3,zebra,true'].join(
      '\n'
    ) + '\n'
  );
  return { bytes, decoded: decodeStaticDictionary(bytes) };
}

function makeConfig(secretId = 0): Buffer {
  const neighborIds = [0, 1, 2, 3].filter((id) => id !== secretId);
  const bytes = Buffer.alloc(12 + 2 * 10 + 4);
  bytes.write('HCW2', 0, 'ascii');
  bytes.writeUInt32LE(3, 4);
  bytes.writeUInt16LE(secretId, 8);
  bytes.writeUInt16LE(2, 10);
  let offset = 12;
  bytes.writeUInt16LE(neighborIds[0]!, offset);
  bytes.writeDoubleLE(0.9, offset + 2);
  offset += 10;
  bytes.writeUInt16LE(neighborIds[1]!, offset);
  bytes.writeDoubleLE(0.8, offset + 2);
  offset += 10;
  bytes.writeUInt16LE(neighborIds[2]!, offset);
  bytes.writeInt16LE(1234, offset + 2);
  return gzipSync(bytes);
}

test('decodes the versioned full-vocabulary format', () => {
  const { decoded } = makeDictionary();
  const config = decodeStaticWordConfig(makeConfig(), 'apple', decoded);
  expect(config).toEqual({
    closest_word: 'apex',
    closest_similarity: 0.9,
    furthest_word: 'zebra',
    furthest_similarity: 0.1234,
    similar_words: [
      { word: 'apex', similarity: 0.9, is_hint: true },
      { word: 'banana', similarity: 0.8, is_hint: false },
      { word: 'zebra', similarity: 0.1234, is_hint: true },
    ],
  });
});

test('rejects a target file whose secret ID does not match its filename', () => {
  const { decoded } = makeDictionary();
  const config = Buffer.from(makeConfig());
  const raw = Buffer.from(config);
  expect(() => decodeStaticWordConfig(raw, 'banana', decoded)).toThrow('Invalid secret ID');
});

test('loads the dictionary and encoded target filename from GitHub Raw', async () => {
  const dictionary = makeDictionary();
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/_dictionary.csv.gz')) return new Response(dictionary.bytes);
    if (pathname.endsWith('/apple.bin.gz')) return new Response(makeConfig());
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(getStaticWordConfig('apple')).resolves.toMatchObject({
      closest_word: 'apex',
      furthest_word: 'zebra',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${STATIC_WORD_DATA_BASE_URL}/apple.bin.gz?release=v1-full-64639-r2`,
      expect.objectContaining({ headers: { Accept: 'application/octet-stream' } })
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test('recovers when a target appears after an initial GitHub 404', async () => {
  const dictionary = makeDictionary();
  let missingRequests = 0;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith('/_dictionary.csv.gz')) return new Response(dictionary.bytes);
    if (pathname.endsWith('/banana.bin.gz')) {
      missingRequests++;
      return missingRequests === 1
        ? new Response('', { status: 404 })
        : new Response(makeConfig(2));
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(getStaticWordConfig('banana')).resolves.toBeNull();
    await expect(getStaticWordConfig('banana')).resolves.toMatchObject({
      closest_word: 'apple',
      furthest_word: 'zebra',
    });
    expect(missingRequests).toBe(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
