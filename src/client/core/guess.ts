// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { fetcher } from '../utils/fetcher';

// ---------------------------------------------------------
// Types & constants
// ---------------------------------------------------------
export type GuessLookupResult = {
  word: string; // normalized and lemma-corrected word used for lookup
  similarity: number;
  rank: number;
};

// Entry stored in per-letter shard maps
type ShardMapEntry = {
  similarity: number;
  rank: number;
};

type CachedMapData = {
  wordMap: [string, ShardMapEntry][]; // Serializable format
  timestamp: number;
  challengeNumber: number;
};

// Map key is `${challengeNumber}-${letter}` ➜ value is Map<word, ShardMapEntry>
const fileCache: Map<string, Map<string, ShardMapEntry>> = new Map();

// Export a readonly snapshot accessor so preloaders can check memory warmness
export const isLetterLoadedInMemory = (challengeNumber: number, letter: string): boolean => {
  const normalized = letter.toLowerCase();
  const fileKey = `${String(challengeNumber)}-${normalized}`;
  return fileCache.has(fileKey);
};

const DB_NAME = 'guess-cache-v1';
const DB_VERSION = 1;
const STORE_NAME = 'parsed-maps';
const LEMMA_STORE_NAME = 'lemma-map';
const CACHE_DAYS = 3; // Keep cache for 3 days

// ---------------------------------------------------------
// IndexedDB helpers (vanilla API – no external deps)
// ---------------------------------------------------------
const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // Clear old stores if upgrading
      const storeNames = Array.from(db.objectStoreNames);
      for (const storeName of storeNames) {
        db.deleteObjectStore(storeName);
      }

      // Create new store with index for cleanup
      const store = db.createObjectStore(STORE_NAME);
      store.createIndex('timestamp', 'timestamp', { unique: false });
      store.createIndex('challengeNumber', 'challengeNumber', { unique: false });

      // Lemma cache store
      const lemmaStore = db.createObjectStore(LEMMA_STORE_NAME);
      lemmaStore.createIndex('timestamp', 'timestamp', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

/**
 * Clear client-side caches used by the guess system:
 * - In-memory letter maps
 * - Hint order cache
 * - IndexedDB backing store
 */
export async function resetGuessCache(): Promise<void> {
  try {
    fileCache.clear();
  } catch {
    // ignore
  }
  try {
    hintOrderCache.clear();
  } catch {
    // ignore
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  } catch {
    // ignore
  }
}

const getMapFromDB = async (key: string): Promise<Map<string, ShardMapEntry> | null> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite'); // Changed to readwrite for deletion
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      const result = req.result as CachedMapData | undefined;
      if (!result) {
        resolve(null);
        return;
      }

      // Check if cache is expired (older than CACHE_DAYS)
      const now = Date.now();
      const maxAge = CACHE_DAYS * 24 * 60 * 60 * 1000;
      if (now - result.timestamp > maxAge) {
        console.log(`[guess] deleting expired map from IDB: ${key}`);
        // Delete expired entry
        store.delete(key);
        resolve(null);
        return;
      }

      // Convert back to Map
      const wordMap = new Map(result.wordMap);
      resolve(wordMap);
    };
    req.onerror = () => reject(req.error);
  });
};

const saveMapToDB = async (
  key: string,
  wordMap: Map<string, ShardMapEntry>,
  challengeNumber: number
): Promise<void> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const cachedData: CachedMapData = {
      wordMap: Array.from(wordMap.entries()),
      timestamp: Date.now(),
      challengeNumber,
    };

    const req = store.put(cachedData, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

// ---------------------------------------------------------
// Small helpers
// ---------------------------------------------------------
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const LETTERS_SET = new Set(LETTERS);

const normalizeWord = (word: string): string => word.trim().toLowerCase();
const normalizeLetter = (letterRaw: string): string | null => {
  const letter = letterRaw.trim().toLowerCase();
  return LETTERS_SET.has(letter) ? letter : null;
};
const buildFileKey = (challengeNumber: number, letter: string): string =>
  `${String(challengeNumber)}-${letter}`;

// ---------------------------------------------------------
// Parsing utility
// ---------------------------------------------------------
const parseCsvToMap = (csv: string): Map<string, ShardMapEntry> => {
  const wordMap = new Map<string, ShardMapEntry>();
  const rows = csv.split(/\r?\n/);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    if (i === 0 && row.toLowerCase().startsWith('word,')) continue; // skip header if present

    const [wordRaw, simStr, rankStr] = row.split(',');
    if (!wordRaw || !simStr) continue;

    const similarity = Number.parseFloat(simStr);
    const rank = rankStr ? Number.parseInt(rankStr, 10) : NaN;

    if (!Number.isNaN(similarity)) {
      const word = normalizeWord(wordRaw);
      wordMap.set(word, {
        similarity,
        rank: Number.isNaN(rank) ? Infinity : rank,
      });
    }
  }

  return wordMap;
};

// ---------------------------------------------------------
// Lemma map (lazy-loaded on first guess)
// ---------------------------------------------------------
const lemmaMap: Map<string, string> = new Map();
let lemmaLoadPromise: Promise<void> | null = null;

type CachedLemmaData = {
  pairs: [string, string][];
  timestamp: number;
};

const getLemmaFromDB = async (): Promise<Map<string, string> | null> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEMMA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LEMMA_STORE_NAME);
    const req = store.get('lemma');
    req.onsuccess = () => {
      const result = req.result as CachedLemmaData | undefined;
      if (!result) {
        resolve(null);
        return;
      }
      const now = Date.now();
      const maxAge = CACHE_DAYS * 24 * 60 * 60 * 1000;
      if (now - result.timestamp > maxAge) {
        console.log(`[guess] deleting expired lemma from IDB`);
        store.delete('lemma');
        resolve(null);
        return;
      }
      resolve(new Map(result.pairs));
    };
    req.onerror = () => reject(req.error);
  });
};

const saveLemmaToDB = async (pairs: [string, string][]): Promise<void> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEMMA_STORE_NAME, 'readwrite');
    const store = tx.objectStore(LEMMA_STORE_NAME);
    const data: CachedLemmaData = { pairs, timestamp: Date.now() };
    const req = store.put(data, 'lemma');
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
};

const ensureLemmaMapLoaded = async (): Promise<void> => {
  if (lemmaLoadPromise) return lemmaLoadPromise;
  lemmaLoadPromise = (async () => {
    try {
      // 1) Try IndexedDB cache first
      const cached = await getLemmaFromDB();
      if (cached) {
        lemmaMap.clear();
        for (const [w, l] of cached.entries()) lemmaMap.set(w, l);
        return;
      }

      // 2) Fetch fresh CSV and cache it
      const text = await fetcher.request<string>('/lemma.csv', { timeout: 4000, maxAttempts: 2 });
      const pairs: [string, string][] = [];
      const rows = text.split(/\r?\n/);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;
        if (i === 0 && row.toLowerCase().startsWith('word,')) continue; // header
        const [wordRaw, lemmaRaw] = row.split(',', 2);
        if (!wordRaw || !lemmaRaw) continue;
        const w = normalizeWord(wordRaw);
        const l = normalizeWord(lemmaRaw);
        if (w && l) {
          lemmaMap.set(w, l);
          pairs.push([w, l]);
        }
      }
      void saveLemmaToDB(pairs).catch(() => {});
    } catch {
      // Ignore failures; lemma correction is best-effort
    }
  })();
  return lemmaLoadPromise;
};

// ---------------------------------------------------------
// Preload support
// ---------------------------------------------------------

// Default order skewed by English first-letter frequency in common vocabulary
export const DEFAULT_PRELOAD_ORDER: string[] = [
  's',
  'c',
  'p',
  'b',
  't',
  'a',
  'm',
  'r',
  'd',
  'h',
  'l',
  'g',
  'n',
  'i',
  'o',
  'f',
  'e',
  'w',
  'k',
  'v',
  'u',
  'y',
  'j',
  'q',
  'x',
  'z',
];

const hintOrderCache = new Map<number, string[]>();

/**
 * Compute a challenge-specific letter order from `_hint.csv` (top 500 words),
 * falling back to DEFAULT_PRELOAD_ORDER when unavailable.
 */
export async function getLetterPreloadOrder(challengeNumber: number): Promise<string[]> {
  if (hintOrderCache.has(challengeNumber)) return hintOrderCache.get(challengeNumber)!;
  try {
    const csv = await fetcher.request<string>(`/api/challenges/${challengeNumber}/_hint.csv`, {
      timeout: 3000,
      maxAttempts: 2,
    });
    const counts = new Map<string, number>();
    for (const row of csv.split(/\r?\n/)) {
      if (!row || row.startsWith('word,')) continue;
      const [wordRaw] = row.split(',');
      if (!wordRaw) continue;
      const letter = normalizeLetter(wordRaw.charAt(0));
      if (!letter) continue;
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
    // Sort letters by frequency desc, then fallback to DEFAULT order to stabilize
    const byFreq = [...LETTERS].sort((a, b) => {
      const da = counts.get(a) ?? -1; // -1 ensures letters seen rank above unseen when both 0
      const db = counts.get(b) ?? -1;
      if (db !== da) return db - da;
      return DEFAULT_PRELOAD_ORDER.indexOf(a) - DEFAULT_PRELOAD_ORDER.indexOf(b);
    });
    hintOrderCache.set(challengeNumber, byFreq);
    return byFreq;
  } catch {
    hintOrderCache.set(challengeNumber, DEFAULT_PRELOAD_ORDER);
    return DEFAULT_PRELOAD_ORDER;
  }
}

/**
 * Ensure and return the Map for a given letter. Uses memory ➜ IndexedDB ➜ network.
 */
async function loadLetterMap(
  challengeNumber: number,
  letterRaw: string
): Promise<Map<string, ShardMapEntry>> {
  const letter = normalizeLetter(letterRaw);
  if (!letter) return new Map();
  const fileKey = buildFileKey(challengeNumber, letter);

  const inMemory = fileCache.get(fileKey);
  if (inMemory) return inMemory;

  // Try IndexedDB first
  try {
    const cached = await getMapFromDB(fileKey);
    if (cached) {
      fileCache.set(fileKey, cached);
      return cached;
    }
  } catch {
    // ignore and continue to network
  }

  // Fetch and parse
  const csv = await fetcher.request<string>(`/api/challenges/${challengeNumber}/${letter}.csv`, {
    timeout: 5000,
    maxAttempts: 2,
  });
  const map = parseCsvToMap(csv);
  fileCache.set(fileKey, map);
  // Persist asynchronously
  void saveMapToDB(fileKey, map, challengeNumber).catch(() => {});
  return map;
}

/** Ensure a single letter map is loaded into memory and IndexedDB cache. */
async function ensureLetterMapLoaded(challengeNumber: number, letterRaw: string): Promise<void> {
  await loadLetterMap(challengeNumber, letterRaw);
}

/**
 * Preload a set of letter maps with limited concurrency. Skips already-warm letters.
 */
export async function preloadLetterMaps(params: {
  challengeNumber: number;
  letters: string[];
  concurrency?: number;
}): Promise<void> {
  const { challengeNumber, letters, concurrency = 3 } = params;
  const queue = letters
    .map((l) => normalizeLetter(l))
    .filter((l): l is string => !!l)
    .filter((l) => !isLetterLoadedInMemory(challengeNumber, l));

  if (queue.length === 0) return;

  let index = 0;
  const workers: Promise<void>[] = [];
  const spawn = () =>
    (async () => {
      while (index < queue.length) {
        const current = queue[index++]!;
        try {
          await ensureLetterMapLoaded(challengeNumber, current);
        } catch {
          // ignore failures; best-effort preloading
        }
      }
    })();

  const numWorkers = Math.max(1, Math.min(concurrency, queue.length));
  for (let i = 0; i < numWorkers; i++) workers.push(spawn());
  await Promise.all(workers);
}

// ---------------------------------------------------------
// Main function (lookup single word by its first-letter shard)
// ---------------------------------------------------------
export const makeGuess = async (guess: string): Promise<GuessLookupResult | null> => {
  const challengeNumber = requireChallengeNumber();

  const overallStart = performance.now();
  if (!guess) return null;

  await ensureLemmaMapLoaded();

  let normalizedGuess = normalizeWord(guess);
  const lemma = lemmaMap.get(normalizedGuess);
  if (lemma && lemma.length > 0) {
    normalizedGuess = lemma;
  }
  const letterRaw = normalizedGuess.charAt(0);
  const normalizedLetter = normalizeLetter(letterRaw);
  if (!normalizedLetter) return null;

  // Measure source for logging
  let cacheSource = 'memory/IDB/network';
  const idbStart = performance.now();
  const mapBefore = fileCache.get(buildFileKey(challengeNumber, normalizedLetter));

  const wordMap = await loadLetterMap(challengeNumber, normalizedLetter);

  if (mapBefore) {
    cacheSource = 'memory (0ms)';
  } else {
    // We cannot perfectly know if it was IDB or network without plumbing; infer by timing
    const idbTime = performance.now() - idbStart;
    cacheSource = `fetched (~${idbTime.toFixed(2)}ms)`;
  }

  const entry = wordMap.get(normalizedGuess) ?? null;
  const result = entry
    ? { word: normalizedGuess, similarity: entry.similarity, rank: entry.rank }
    : null;

  console.log(
    `[guess] lookup for "${normalizedGuess}" completed in ${(
      performance.now() - overallStart
    ).toFixed(2)}ms (source: ${cacheSource})`
  );

  return result;
};
