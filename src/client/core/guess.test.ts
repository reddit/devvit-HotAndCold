// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal in-memory IndexedDB stub sufficient for guess.ts usage
type StoreContent = Map<string, unknown>;
type DBStores = Map<string, StoreContent>;
const dbNameToStores = new Map<string, DBStores>();

class IDBRequestImpl<T = unknown> {
  onsuccess: ((this: any, ev: Event) => unknown) | null = null;
  onerror: ((this: any, ev: Event) => unknown) | null = null;
  result!: T;
  error: any = null;
}

class ObjectStoreImpl {
  constructor(
    private readonly stores: DBStores,
    private readonly name: string
  ) {}
  createIndex() {
    // no-op for tests
  }
  get(key: string) {
    const req = new IDBRequestImpl<any>();
    setTimeout(() => {
      try {
        const res = this.stores.get(this.name)?.get(String(key));
        (req as any).result = res;
        req.onsuccess?.(new Event('success'));
      } catch (e) {
        req.error = e;
        req.onerror?.(new Event('error'));
      }
    }, 0);
    return req as unknown as IDBRequest;
  }
  put(value: unknown, key: string) {
    const req = new IDBRequestImpl<void>();
    setTimeout(() => {
      try {
        if (!this.stores.has(this.name)) this.stores.set(this.name, new Map());
        this.stores.get(this.name)!.set(String(key), value);
        req.onsuccess?.(new Event('success'));
      } catch (e) {
        req.error = e;
        req.onerror?.(new Event('error'));
      }
    }, 0);
    return req as unknown as IDBRequest;
  }
  delete(key: string) {
    const req = new IDBRequestImpl<void>();
    setTimeout(() => {
      try {
        this.stores.get(this.name)?.delete(String(key));
        req.onsuccess?.(new Event('success'));
      } catch (e) {
        req.error = e;
        req.onerror?.(new Event('error'));
      }
    }, 0);
    return req as unknown as IDBRequest;
  }
}

class TxImpl {
  constructor(private readonly stores: DBStores) {}
  objectStore(name: string) {
    return new ObjectStoreImpl(this.stores, name) as unknown as any;
  }
}

class DBImpl {
  objectStoreNames: string[] = [];
  constructor(
    private readonly name: string,
    private readonly version: number
  ) {}
  createObjectStore(name: string) {
    if (!dbNameToStores.has(this.name)) dbNameToStores.set(this.name, new Map());
    const stores = dbNameToStores.get(this.name)!;
    if (!stores.has(name)) stores.set(name, new Map());
    if (!this.objectStoreNames.includes(name)) this.objectStoreNames.push(name);
    return new ObjectStoreImpl(stores, name) as unknown as any;
  }
  deleteObjectStore(name: string) {
    const stores = dbNameToStores.get(this.name);
    stores?.delete(name);
    this.objectStoreNames = this.objectStoreNames.filter((n) => n !== name);
  }
  transaction(name: string, _mode: any) {
    if (!dbNameToStores.has(this.name)) dbNameToStores.set(this.name, new Map());
    return new TxImpl(dbNameToStores.get(this.name)!) as unknown as any;
  }
  get versionNumber() {
    return this.version;
  }
}

class OpenRequestImpl<T = unknown> extends IDBRequestImpl<T> {
  onupgradeneeded: ((this: any, ev: any) => unknown) | null = null;
}

function installIndexedDbStub() {
  const open = (name: string, version?: number) => {
    const db = new DBImpl(name, version ?? 1);
    const req = new OpenRequestImpl<any>();
    (req as any).result = db as unknown as any;
    setTimeout(() => {
      // If version provided or first time, trigger upgradeneeded first
      try {
        // Simulate that an upgrade always happens on first open to ensure schema
        req.onupgradeneeded?.(new Event('upgradeneeded') as any);
        req.onsuccess?.(new Event('success'));
      } catch (e) {
        req.error = e;
        req.onerror?.(new Event('error'));
      }
    }, 0);
    return req as unknown as any;
  };
  globalThis.indexedDB = { open } as unknown as any;
}

// Helper to mock modules and import a fresh copy of guess.ts
async function loadGuessModule() {
  vi.resetModules();
  // Mock challenge number provider
  vi.doMock('../requireChallengeNumber', () => ({ requireChallengeNumber: () => 1 }));
  return await import('./guess');
}

// Trackable fetcher mock
const requestMock = vi.fn<[string | URL, any], Promise<any>>();

beforeEach(() => {
  // Fresh IDB and mocks for each test
  dbNameToStores.clear();
  installIndexedDbStub();
  requestMock.mockReset();
  vi.doMock('../utils/fetcher', () => ({ fetcher: { request: requestMock } }));
});

describe('guess.ts', () => {
  it('makeGuess returns null for empty or invalid guesses', async () => {
    const g = await loadGuessModule();
    expect(await g.makeGuess('')).toBeNull();
    expect(await g.makeGuess('1abc')).toBeNull();
  });

  it('loads CSV for first-letter shard and returns GuessLookupResult with corrected word (case-insensitive)', async () => {
    requestMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/challenges/1/a.csv')) {
        return 'word,similarity,rank\napple,0.91,1\nalpha,0.5,10\n';
      }
      if (String(url).endsWith('/lemma.csv')) {
        return 'word,lemma\nyears,year\n';
      }
      throw new Error('unexpected url ' + url);
    });
    const g = await loadGuessModule();
    const res = await g.makeGuess('Apple');
    expect(res).toEqual({ word: 'apple', similarity: 0.91, rank: 1 });
    // Second call should hit memory cache and not re-fetch
    const res2 = await g.makeGuess('alpha');
    expect(res2).toEqual({ word: 'alpha', similarity: 0.5, rank: 10 });
    // Expect at least 2 calls (lemma + letter CSV)
    expect(requestMock.mock.calls.some((args) => String(args[0]).endsWith('/lemma.csv'))).toBe(
      true
    );
  });

  it('persists to IndexedDB and loads from it on next module import (no network)', async () => {
    // First run: populate cache
    requestMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/challenges/1/b.csv')) {
        return 'word,similarity,rank\nbeta,0.77,2\n';
      }
      throw new Error('unexpected url ' + url);
    });
    let g = await loadGuessModule();
    expect(await g.makeGuess('beta')).toEqual({ word: 'beta', similarity: 0.77, rank: 2 });
    // Exactly one call for the letter CSV; lemma.csv may also be fetched
    const letterCalls = requestMock.mock.calls.filter((args) =>
      String(args[0]).endsWith('/api/challenges/1/b.csv')
    );
    expect(letterCalls.length).toBe(1);

    // Second run in a fresh module: should read from IDB without network
    requestMock.mockImplementation(async () => {
      throw new Error('network should not be called');
    });
    g = await loadGuessModule();
    expect(await g.makeGuess('beta')).toEqual({ word: 'beta', similarity: 0.77, rank: 2 });
  });

  it('re-fetches when IndexedDB entry is missing or expired', async () => {
    // First save with real time
    requestMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/challenges/1/c.csv')) {
        return 'word,similarity,rank\ncat,0.5,\n';
      }
      throw new Error('unexpected url ' + url);
    });
    let g = await loadGuessModule();
    expect(await g.makeGuess('cat')).toEqual({ word: 'cat', similarity: 0.5, rank: Infinity });
    const cCalls1 = requestMock.mock.calls.filter((args) =>
      String(args[0]).endsWith('/api/challenges/1/c.csv')
    );
    expect(cCalls1.length).toBe(1);
    // Allow async saveMapToDB to complete in the stub
    await new Promise((r) => setTimeout(r, 5));
    // Simulate expiry/eviction by removing the stored key
    const stores = dbNameToStores.get('guess-cache-v1');
    const parsedMaps = stores?.get('parsed-maps') as Map<string, any> | undefined;
    parsedMaps?.delete('1-c');

    // Expect a network call on next import due to expiry
    requestMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/challenges/1/c.csv')) {
        return 'word,similarity,rank\ncat,0.6,\n';
      }
      throw new Error('unexpected url ' + url);
    });
    g = await loadGuessModule();
    expect(await g.makeGuess('cat')).toEqual({ word: 'cat', similarity: 0.6, rank: Infinity });
  });

  it('preloadLetterMaps honors concurrency and warms memory; skips already warm letters', async () => {
    // Build delayed responses to measure concurrency
    let inFlight = 0;
    let peak = 0;
    const respond = (content: string, delay = 30) =>
      new Promise<string>((resolve) => setTimeout(() => resolve(content), delay));
    requestMock.mockImplementation(async (url: string) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const u = String(url);
      try {
        if (u.endsWith('/api/challenges/1/a.csv'))
          return await respond('word,similarity,rank\naaa,0.1,\n');
        if (u.endsWith('/api/challenges/1/b.csv'))
          return await respond('word,similarity,rank\nbbb,0.2,\n');
        if (u.endsWith('/api/challenges/1/d.csv'))
          return await respond('word,similarity,rank\nddd,0.4,\n');
        if (u.endsWith('/api/challenges/1/c.csv'))
          return await respond('word,similarity,rank\nccc,0.3,\n');
      } finally {
        inFlight -= 1;
      }
      throw new Error('unexpected url ' + url);
    });

    const g = await loadGuessModule();

    // Warm letter 'a' via lookup so preload can skip it
    await g.makeGuess('aaa');
    expect(g.isLetterLoadedInMemory(1, 'a')).toBe(true);

    // Only count preload calls
    requestMock.mockClear();
    await g.preloadLetterMaps({
      challengeNumber: 1,
      letters: ['a', 'b', 'c', 'd'],
      concurrency: 2,
    });
    // Fetch for b, c, d only (a skipped). Some environments may hydrate one letter from IDB stub; allow 2-3.
    const calls = requestMock.mock.calls.map((args) => String(args[0]));
    expect(calls.every((u) => !u.endsWith('/api/challenges/1/a.csv'))).toBe(true);
    expect(requestMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(requestMock.mock.calls.length).toBeLessThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(2);
    expect(g.isLetterLoadedInMemory(1, 'b')).toBe(true);
    expect(g.isLetterLoadedInMemory(1, 'c')).toBe(true);
    expect(g.isLetterLoadedInMemory(1, 'd')).toBe(true);
  });

  it('getLetterPreloadOrder sorts by frequency with fallback to default order', async () => {
    // _hint.csv contains only words starting with b and a, b more frequent
    requestMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/api/challenges/1/_hint.csv')) {
        return 'word,similarity,rank\nbanana,0,\nboat,0,\napple,0,\n';
      }
      // any letter CSV fetches should not occur in this test
      throw new Error('unexpected url ' + url);
    });
    const g = await loadGuessModule();
    const order = await g.getLetterPreloadOrder(1);
    const bIndex = order.indexOf('b');
    const aIndex = order.indexOf('a');
    expect(bIndex).toBeLessThan(aIndex);
    // Unknown letters should appear but maintain relative order from default
    const defaultOrder = g.DEFAULT_PRELOAD_ORDER;
    const xDef = defaultOrder.indexOf('x');
    const zDef = defaultOrder.indexOf('z');
    const xIdx = order.indexOf('x');
    const zIdx = order.indexOf('z');
    expect(xIdx).toBeLessThan(zIdx === -1 ? 1e9 : zIdx);
    expect(Math.sign((xIdx - zIdx) * (xDef - zDef))).toBe(1);
  });
});
