import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable mock fns that hoisted mocks will delegate to
let makeGuessMock: any;
let preloadLetterMapsMock: any;
let getLetterPreloadOrderMock: any;

const navigation = {
  markSolvedForCurrentChallenge: vi.fn(),
};

const trpcMock = {
  game: { get: { query: vi.fn() } },
  guess: { submitBatch: { mutate: vi.fn() } },
};

// Hoisted module mocks that resolve from globalThis to avoid hoist capture issues in browser
vi.mock('./guess', () => ({
  makeGuess: (...args: any[]) => (globalThis as any).__guessMocks?.makeGuess?.(...args),
  preloadLetterMaps: (...args: any[]) =>
    (globalThis as any).__guessMocks?.preloadLetterMaps?.(...args),
  getLetterPreloadOrder: (...args: any[]) =>
    (globalThis as any).__guessMocks?.getLetterPreloadOrder?.(...args),
}));

vi.mock('../trpc', () => ({
  trpc: new Proxy(
    {},
    {
      get(_target, prop: string) {
        return (globalThis as any).__trpcMock?.[prop as any];
      },
    }
  ),
}));

vi.mock('../classic/state/navigation', () => ({
  markSolvedForCurrentChallenge: (...args: any[]) =>
    (globalThis as any).__navigationMock?.markSolvedForCurrentChallenge?.(...args),
  // Provide minimal stubs for named exports that might be imported elsewhere
  navigate: (..._args: any[]) => {},
  initNavigation: (..._args: any[]) => {},
  page: { value: 'play' },
}));

import { createGuessEngine } from './guessEngine';

function advanceRateLimitBeyond(ms: number) {
  const now = Date.now();
  vi.setSystemTime(now + ms + 1);
}

describe('guessEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.setSystemTime(1_000_000);
    navigation.markSolvedForCurrentChallenge.mockReset();
    trpcMock.game.get.query.mockReset();
    trpcMock.guess.submitBatch.mutate.mockReset();

    // Reset storages between tests
    window.localStorage.clear();
    window.sessionStorage.clear();

    // Fresh delegate mocks each test
    makeGuessMock = vi.fn();
    preloadLetterMapsMock = vi.fn();
    getLetterPreloadOrderMock = vi.fn();

    // Expose via global for hoisted factories
    (globalThis as any).__guessMocks = {
      makeGuess: makeGuessMock,
      preloadLetterMaps: preloadLetterMapsMock,
      getLetterPreloadOrder: getLetterPreloadOrderMock,
    };
    (globalThis as any).__trpcMock = trpcMock;
    (globalThis as any).__navigationMock = navigation;
  });

  it('validates input and returns appropriate errors without mutating state', async () => {
    const engine = createGuessEngine({ challengeNumber: 1, rateLimitMs: 100 });

    let res = await engine.submit('');
    expect(res).toEqual({ ok: false, code: 'EMPTY', message: expect.any(String) });
    expect(engine.history.value).toEqual([]);
    expect(engine.isSubmitting.value).toBe(false);

    res = await engine.submit('a');
    expect(res).toMatchObject({ ok: false, code: 'TOO_SHORT' });

    res = await engine.submit('1abc');
    expect(res).toMatchObject({ ok: false, code: 'INVALID_CHARS' });
  });

  it('applies rate limiting based on rateLimitMs', async () => {
    const engine = createGuessEngine({ challengeNumber: 1, rateLimitMs: 1000 });

    makeGuessMock.mockResolvedValueOnce({ word: 'apple', similarity: 0.2, rank: 50 });
    let res = await engine.submit('apple');
    expect(res).toEqual({ ok: true, word: 'apple', similarity: 0.2, rank: 50 });
    expect(makeGuessMock).toHaveBeenCalledTimes(1);

    // Immediately submit again – should be rate limited, no second makeGuess call
    res = await engine.submit('alpha');
    expect(res).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    expect(makeGuessMock).toHaveBeenCalledTimes(1);
  });

  it('records successful guesses, maps non-finite rank to -1 in history and null in result', async () => {
    const engine = createGuessEngine({ challengeNumber: 7, rateLimitMs: 1 });

    makeGuessMock.mockResolvedValueOnce({ word: 'beta', similarity: 0.5, rank: Infinity });
    const res = await engine.submit('Beta');
    expect(res).toEqual({ ok: true, word: 'beta', similarity: 0.5, rank: null });
    expect(engine.history.value).toHaveLength(1);
    expect(engine.history.value[0]).toMatchObject({ word: 'beta', similarity: 0.5, rank: -1 });
  });

  it('returns NOT_IN_DICTIONARY when lookup misses', async () => {
    const engine = createGuessEngine({ challengeNumber: 2 });

    makeGuessMock.mockResolvedValueOnce(null as any);
    const res = await engine.submit('ghostword');
    expect(res).toMatchObject({ ok: false, code: 'NOT_IN_DICTIONARY', word: 'ghostword' });
    expect(engine.history.value).toHaveLength(0);
  });

  it('marks solved and calls navigation when a correct guess is made', async () => {
    const engine = createGuessEngine({ challengeNumber: 3, rateLimitMs: 1 });

    makeGuessMock.mockResolvedValueOnce({ word: 'winner', similarity: 1, rank: 1 });
    // Backend verifies win and returns solvedAt
    trpcMock.guess.submitBatch.mutate.mockResolvedValueOnce({
      challengeUserInfo: { solvedAtMs: 2222 },
    });
    const res = await engine.submit('Winner');
    expect(res).toEqual({ ok: true, word: 'winner', similarity: 1, rank: 1 });
    expect(trpcMock.guess.submitBatch.mutate).toHaveBeenCalledWith({
      challengeNumber: 3,
      guesses: [{ word: 'winner', similarity: 1, rank: 1, atMs: expect.any(Number) }],
    });
    expect(engine.solvedAtMs.value).toBe(2222);
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalledWith(2222);
  });

  it('shows loading (isSubmitting=true) while a winning guess is being verified server-side', async () => {
    const engine = createGuessEngine({ challengeNumber: 101, rateLimitMs: 0 });

    makeGuessMock.mockResolvedValueOnce({ word: 'victory', similarity: 1, rank: 2 });

    let resolveServer: (v: any) => void;
    const serverPromise = new Promise((r) => {
      resolveServer = r as any;
    });
    trpcMock.guess.submitBatch.mutate.mockImplementationOnce(() => serverPromise as any);

    const submitPromise = engine.submit('Victory');
    // Should be loading while waiting for server
    expect(engine.isSubmitting.value).toBe(true);

    // Resolve server and complete
    resolveServer!({ challengeUserInfo: { solvedAtMs: 3333 } });
    await submitPromise;

    expect(engine.isSubmitting.value).toBe(false);
    expect(engine.solvedAtMs.value).toBe(3333);
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalledWith(3333);
  });

  it('on duplicate submission, returns DUPLICATE and re-asserts solved state when a prior winning guess exists', async () => {
    const engine = createGuessEngine({ challengeNumber: 4, rateLimitMs: 10 });

    // First: win
    makeGuessMock.mockResolvedValueOnce({ word: 'gold', similarity: 1, rank: 3 });
    await engine.submit('gold');
    advanceRateLimitBeyond(10);

    // Duplicate: should not call makeGuess; ensure DUPLICATE and ensure solved stays marked
    const callsBefore = makeGuessMock.mock.calls.length;
    const res = await engine.submit('gold');
    expect(res).toMatchObject({ ok: false, code: 'DUPLICATE', word: 'gold' });
    expect(makeGuessMock.mock.calls.length).toBe(callsBefore);
    expect(engine.solvedAtMs.value).not.toBeNull();
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalled();
  });

  it('treats lemma-corrected duplicates as duplicates (e.g., years -> year)', async () => {
    const engine = createGuessEngine({ challengeNumber: 8, rateLimitMs: 0 });

    // First guess: 'year'
    makeGuessMock.mockResolvedValueOnce({ word: 'year', similarity: 0.4, rank: 12 });
    const first = await engine.submit('year');
    expect(first).toEqual({ ok: true, word: 'year', similarity: 0.4, rank: 12 });

    // Second guess: 'years' which lemma-corrects to 'year' – should be detected as duplicate
    makeGuessMock.mockResolvedValueOnce({ word: 'year', similarity: 0.3, rank: 20 });
    const dup = await engine.submit('years');
    expect(dup).toMatchObject({ ok: false, code: 'DUPLICATE', word: 'year' });
    expect(engine.history.value).toHaveLength(1);
  });

  it('preload tiers schedule increasing letter batches based on distinct guesses in-session', async () => {
    const engine = createGuessEngine({ challengeNumber: 5, rateLimitMs: 0 });

    getLetterPreloadOrderMock.mockResolvedValueOnce('abcdefghijklmnopqrstuvwxyz'.split(''));
    preloadLetterMapsMock.mockResolvedValue();

    // 1st distinct guess -> tier 1
    makeGuessMock.mockResolvedValueOnce({ word: 'able', similarity: 0.1, rank: 100 });
    await engine.submit('able');
    await Promise.resolve();
    expect(preloadLetterMapsMock).toHaveBeenCalledWith({
      challengeNumber: 5,
      letters: 'abcdefghijklmnopqrstuvwxyz'.split('').slice(0, 6),
      concurrency: 3,
    });

    // 2nd distinct guess -> tier 2
    makeGuessMock.mockResolvedValueOnce({ word: 'baker', similarity: 0.2, rank: 90 });
    await engine.submit('baker');
    await Promise.resolve();
    expect(preloadLetterMapsMock).toHaveBeenCalledWith({
      challengeNumber: 5,
      letters: 'abcdefghijklmnopqrstuvwxyz'.split('').slice(6, 12),
      concurrency: 3,
    });

    // 3rd distinct guess -> tier 3
    makeGuessMock.mockResolvedValueOnce({ word: 'cider', similarity: 0.3, rank: 80 });
    await engine.submit('cider');
    await Promise.resolve();
    expect(preloadLetterMapsMock).toHaveBeenCalledWith({
      challengeNumber: 5,
      letters: 'abcdefghijklmnopqrstuvwxyz'.split('').slice(12),
      concurrency: 4,
    });
  });

  it('hydrates from local storage history and seeds guessed set', async () => {
    // Store prior local history with two distinct guesses
    const history = [
      { word: 'alpha', similarity: 0.1, rank: 10, timestamp: 1 },
      { word: 'beta', similarity: 0.2, rank: 20, timestamp: 2 },
    ];
    window.localStorage.setItem('guess-history:9', JSON.stringify(history));
    getLetterPreloadOrderMock.mockResolvedValueOnce('abcdefghijklmnopqrstuvwxyz'.split(''));
    preloadLetterMapsMock.mockResolvedValue();

    const engine = createGuessEngine({ challengeNumber: 9 });
    expect(engine.hasGuessed('alpha')).toBe(true);
    expect(engine.hasGuessed('beta')).toBe(true);
    // No winning guess in the snapshot, so navigation should not be called
    expect(navigation.markSolvedForCurrentChallenge).not.toHaveBeenCalled();
  });

  it('reconciles with server: sets solvedAtMs when server indicates solvedAtMs field', async () => {
    trpcMock.game.get.query.mockResolvedValueOnce({
      challengeUserInfo: {
        solvedAtMs: 12345,
        guesses: [],
      },
    });
    const engine = createGuessEngine({ challengeNumber: 6 });
    await Promise.resolve();
    expect(engine.solvedAtMs.value).toBe(12345);
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalledWith(12345);
  });

  it('reconciles with server: sets solved when any server guess has similarity 1', async () => {
    trpcMock.game.get.query.mockResolvedValueOnce({
      challengeUserInfo: {
        guesses: [
          { word: 'near', similarity: 0.8, rank: 2, timestampMs: 11 },
          { word: 'win', similarity: 1, rank: 1, timestampMs: 22 },
        ],
      },
    });
    const engine = createGuessEngine({ challengeNumber: 11 });
    await Promise.resolve();
    expect(engine.solvedAtMs.value).toBe(22);
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalledWith(22);
  });

  it('ensures backend reflects a local win when submitting a duplicate after reload', async () => {
    // Local snapshot contains a win
    const localWinning = [{ word: 'win', similarity: 1, rank: 1, timestamp: 777 }];
    window.localStorage.setItem('guess-history:13', JSON.stringify(localWinning));
    trpcMock.guess.submitBatch.mutate.mockResolvedValueOnce({ challengeUserInfo: {} });
    // Ensure makeGuess returns something for 'win' so normalization passes guards
    makeGuessMock.mockResolvedValueOnce({ word: 'win', similarity: 1, rank: 1 });

    const engine = createGuessEngine({ challengeNumber: 13, rateLimitMs: 0 });
    // Submitting the winning word again should trigger duplicate path and best-effort sync
    const res = await engine.submit('win');
    expect(res).toMatchObject({ ok: false, code: 'DUPLICATE', word: 'win' });
    expect(trpcMock.guess.submitBatch.mutate).toHaveBeenCalledWith({
      challengeNumber: 13,
      guesses: [{ word: 'win', similarity: 1, rank: 1, atMs: 777 }],
    });
  });

  it('reconciles with server: when server history differs, replaces local history', async () => {
    window.localStorage.setItem(
      'guess-history:21',
      JSON.stringify([{ word: 'local', similarity: 0.1, rank: 10, timestamp: 1 }])
    );

    trpcMock.game.get.query.mockResolvedValueOnce({
      challengeUserInfo: {
        guesses: [{ word: 'server', similarity: 0.3, rank: 3, timestampMs: 5 }],
      },
    });
    const engine = createGuessEngine({ challengeNumber: 21 });
    await Promise.resolve();
    expect(engine.history.value).toEqual([
      { word: 'server', similarity: 0.3, rank: 3, timestamp: 5 },
    ]);
  });

  it('submits guesses to server in the background and uses returned solvedAtMs if provided', async () => {
    const engine = createGuessEngine({ challengeNumber: 30, rateLimitMs: 1 });
    makeGuessMock.mockResolvedValueOnce({ word: 'close', similarity: 0.9, rank: 2 });
    trpcMock.guess.submitBatch.mutate.mockResolvedValueOnce({
      challengeUserInfo: { solvedAtMs: 9999 },
    });
    await engine.submit('close');
    await Promise.resolve();
    expect(trpcMock.guess.submitBatch.mutate).toHaveBeenCalledWith({
      challengeNumber: 30,
      guesses: [{ word: 'close', similarity: 0.9, rank: 2, atMs: expect.any(Number) }],
    });
    expect(engine.solvedAtMs.value).toBe(9999);
    expect(navigation.markSolvedForCurrentChallenge).toHaveBeenCalledWith(9999);
  });

  it('stores and submits the lemma-corrected word instead of the raw input', async () => {
    const engine = createGuessEngine({ challengeNumber: 42, rateLimitMs: 0 });

    makeGuessMock.mockResolvedValueOnce({ word: 'year', similarity: 0.4, rank: 12 });
    const res = await engine.submit('years');

    expect(res).toEqual({ ok: true, word: 'year', similarity: 0.4, rank: 12 });
    expect(engine.history.value.at(-1)).toMatchObject({ word: 'year', similarity: 0.4, rank: 12 });

    // Ensure background submission sends lemma-corrected word
    await Promise.resolve();
    expect(trpcMock.guess.submitBatch.mutate).toHaveBeenCalledWith({
      challengeNumber: 42,
      guesses: [
        {
          word: 'year',
          similarity: 0.4,
          rank: 12,
          atMs: expect.any(Number),
        },
      ],
    });
  });

  it('clear resets state and guessed set', async () => {
    const engine = createGuessEngine({ challengeNumber: 44 });
    makeGuessMock.mockResolvedValueOnce({ word: 'alpha', similarity: 0.2, rank: 5 });
    await engine.submit('alpha');
    expect(engine.history.value).toHaveLength(1);
    engine.clear();
    expect(engine.history.value).toEqual([]);
    expect(engine.lastResult.value).toBeNull();
    expect(engine.isSubmitting.value).toBe(false);
    expect(engine.solvedAtMs.value).toBeNull();
  });
});
