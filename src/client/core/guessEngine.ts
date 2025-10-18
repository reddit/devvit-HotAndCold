/* eslint-disable no-empty */
import { signal, batch } from '@preact/signals';
import { makeGuess, getLetterPreloadOrder, preloadLetterMaps } from './guess';
import { createLocalStorageSignal } from '../utils/localStorageSignal';

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------
export type GuessErrorCode =
  | 'EMPTY'
  | 'TOO_SHORT'
  | 'INVALID_CHARS'
  | 'DUPLICATE'
  | 'NOT_IN_DICTIONARY'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';

export type ClientGuessResult =
  | {
      ok: true;
      word: string;
      similarity: number;
      rank: number | null;
    }
  | {
      ok: false;
      code: GuessErrorCode;
      word?: string;
      message: string;
    };

export type GuessSubmission = {
  word: string;
  similarity: number;
  rank: number; // -1 when unknown
  atMs: number;
  isHint?: boolean;
};

export type GuessEngine = {
  // reactive state
  history: ReturnType<typeof signal<GuessHistoryItem[]>>;
  lastResult: ReturnType<typeof signal<ClientGuessResult | null>>;
  isSubmitting: ReturnType<typeof signal<boolean>>;
  solvedAtMs: ReturnType<typeof signal<number | null>>;

  // derived state
  hasGuessed: (word: string) => boolean;

  // actions
  submit: (raw: string) => Promise<ClientGuessResult>;
  submitHint: (word: string) => Promise<ClientGuessResult>;
  clear: () => void;
};

// ---------------------------------------------------------
// Utilities
// ---------------------------------------------------------
const normalizeWord = (raw: string): string => raw.trim().toLowerCase().replace(/\s+/g, ' ');

const isValidWord = (word: string): boolean => /^[a-zA-Z][a-zA-Z'-]*$/.test(word);

// messages inlined at call sites to reduce indirection

// ---------------------------------------------------------
// Submission queue (fire-and-forget to server)
// ---------------------------------------------------------
// Placeholder: wire to tRPC once server exposes a mutation
import { trpc } from '../trpc';
import { markSolvedForCurrentChallenge } from '../classic/state/navigation';
import posthog from 'posthog-js';
// import { rankToProgress } from '../../shared/progress';

type Submitter = (
  challengeNumber: number,
  items: GuessSubmission[],
  wave?: number | null
) => Promise<{
  solvedAtMs?: number | null;
} | void>;

const submitClassic: Submitter = async (challengeNumber, items) => {
  const res = await trpc.guess.submitBatch.mutate({ challengeNumber, guesses: items });
  if (res && typeof res === 'object' && 'challengeUserInfo' in res) {
    const anyRes = res as any;
    return { solvedAtMs: anyRes.challengeUserInfo?.solvedAtMs ?? null };
  }
};

const submitHorde: Submitter = async (challengeNumber, items, wave) => {
  const res = await trpc.horde.guess.submitBatch.mutate({ challengeNumber, guesses: items, wave: Number.isFinite(Number(wave)) ? Number(wave) : 1 });
  // horde does not include score/solve; return void (no-op) for compatibility
  if (res && typeof res === 'object' && 'challengeUserInfo' in res) {
    const anyRes = res as any;
    return { solvedAtMs: anyRes.challengeUserInfo?.solvedAtMs ?? null };
  }
};

// ---------------------------------------------------------
// Engine factory
// ---------------------------------------------------------
export function createGuessEngine(params: {
  challengeNumber: number;
  rateLimitMs?: number;
  mode?: 'classic' | 'horde';
  waveId?: string | number; // optional sub-key for HORDE waves
}): GuessEngine {
  const { challengeNumber, rateLimitMs = 150, mode = 'horde', waveId } = params;
  const subKey = mode === 'horde' && waveId != null ? `:wave:${String(waveId)}` : '';
  const historyKey = `guess-history:${String(challengeNumber)}${subKey}`;
  const submitBatchToServer: Submitter = mode === 'horde' ? submitHorde : submitClassic;

  // signals
  const { signal: history } = createLocalStorageSignal<GuessHistoryItem[]>({
    key: historyKey,
    initialValue: [],
  });
  const lastResult = signal<ClientGuessResult | null>(null);
  const isSubmitting = signal(false);
  const solvedAtMs = signal<number | null>(null);

  // local state (non-reactive)
  let lastSubmitTs = 0;
  const guessedSet = new Set<string>();
  // Tracks only distinct guesses made during the current in-memory session
  const sessionGuessedSet = new Set<string>();
  let preloadTierReached = 0; // 0=none,1=first batch,2=second batch,3=all remaining
  let letterOrderPromise: Promise<string[]> | null = null;
  const targetWave =
    mode === 'horde' && waveId != null && Number.isFinite(Number(waveId))
      ? Math.max(1, Math.floor(Number(waveId)))
      : null;
  const filterHistoryForWave = <T extends GuessHistoryItem>(list: T[]): T[] => {
    if (!targetWave) return list;
    return list.filter((entry) => Number(entry.wave) === targetWave);
  };
  const waveScope = targetWave ?? undefined;

  const ensureLetterOrder = (): Promise<string[]> => {
    const source =
      mode === 'horde' && waveId != null
        ? ({ mode, wave: Number(waveId) } as const)
        : ({ mode } as const);
    return (letterOrderPromise ??= getLetterPreloadOrder(challengeNumber, source));
  };

  const triggerPreloadForTier = async (tier: number) => {
    try {
      const order = await ensureLetterOrder();
      if (!Array.isArray(order) || order.length === 0) return;
      if (tier === 1) {
        const source =
          mode === 'horde' && waveId != null
            ? ({ mode, wave: Number(waveId) } as const)
            : ({ mode } as const);
        await preloadLetterMaps(
          { challengeNumber, letters: order.slice(0, 6), concurrency: 3 },
          source
        );
      } else if (tier === 2) {
        const source =
          mode === 'horde' && waveId != null
            ? ({ mode, wave: Number(waveId) } as const)
            : ({ mode } as const);
        await preloadLetterMaps(
          { challengeNumber, letters: order.slice(6, 12), concurrency: 3 },
          source
        );
      } else if (tier >= 3) {
        const source =
          mode === 'horde' && waveId != null
            ? ({ mode, wave: Number(waveId) } as const)
            : ({ mode } as const);
        await preloadLetterMaps(
          { challengeNumber, letters: order.slice(12), concurrency: 4 },
          source
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  const maybeSchedulePreloads = () => {
    if (preloadTierReached >= 3) return;
    // Only count guesses made in this runtime session
    const distinct = sessionGuessedSet.size;
    if (distinct >= 1 && preloadTierReached < 1) {
      preloadTierReached = 1;
      void triggerPreloadForTier(1);
    }
    if (distinct >= 2 && preloadTierReached < 2) {
      preloadTierReached = 2;
      void triggerPreloadForTier(2);
    }
    if (distinct >= 3 && preloadTierReached < 3) {
      preloadTierReached = 3;
      void triggerPreloadForTier(3);
    }
  };

  // hydrate tier 1: local history from localStorageSignal
  // Seed guessedSet from hydrated history (used for duplicate checks only)
  if (Array.isArray(history.value) && history.value.length > 0) {
    const filteredLocalHistory = filterHistoryForWave(history.value);
    if (filteredLocalHistory.length !== history.value.length) {
      history.value = filteredLocalHistory;
    }
    const words = history.value.map((i) => i.word);
    words.forEach((w) => guessedSet.add(w));
    const winning = history.value.find((i) => i.similarity === 1);
    if (winning) {
      solvedAtMs.value = winning.timestamp ?? Date.now();
      markSolvedForCurrentChallenge(solvedAtMs.value);
    }
  }

  // no explicit guesses signal; derive when needed from history

  // Ensure backend reflects local win when necessary – implementation is defined later
  let ensureServerHasWin = async (_winning: GuessHistoryItem) => {};

  // hydrate tier 2: server – reconcile (server is source of truth)
  void (async () => {
    const localHistorySnapshot: GuessHistoryItem[] = history.value.slice();
    try {
      const server =
        mode === 'horde'
          ? await trpc.horde.game.get.query({ challengeNumber })
          : await trpc.game.get.query({ challengeNumber });
      const serverHistory: GuessHistoryItem[] = server.challengeUserInfo.guesses.map((g: any) => {
        const s = Number(g.similarity);
        const r = Number(g.rank);
        const t = Number(g.timestampMs);
        return {
          word: String(g.word ?? ''),
          similarity: Number.isFinite(s) ? s : 0,
          rank: Number.isFinite(r) ? r : -1,
          timestamp: Number.isFinite(t) ? t : Date.now(),
          wave: Number((g as any)?.wave) || null,
        };
      });
      const filteredServerHistory = filterHistoryForWave(serverHistory);

      // If server indicates solved, mark immediately
      const serverSolvedAt = server?.challengeUserInfo?.solvedAtMs;
      if (serverSolvedAt && Number.isFinite(Number(serverSolvedAt))) {
        solvedAtMs.value = Number(serverSolvedAt);
        markSolvedForCurrentChallenge(solvedAtMs.value);
      } else {
        const winning = serverHistory.find((i) => i.similarity === 1);
        if (winning) {
          solvedAtMs.value = winning.timestamp ?? Date.now();
          markSolvedForCurrentChallenge(solvedAtMs.value);
        } else {
          // Server does not show a win yet; if local snapshot had a winning guess,
          // submit it so leaderboard/stats are updated server-side.
          const localWinning = localHistorySnapshot.find((i) => i.similarity === 1);
          if (localWinning) {
            void ensureServerHasWin(localWinning);
          }
        }
      }

      // Always prefer server and persist locally via localStorageSignal
      batch(() => {
        history.value = filteredServerHistory;
        guessedSet.clear();
        filteredServerHistory.forEach((item) => guessedSet.add(item.word));
      });
    } catch (e) {
      // ignore network/server errors; keep local
    }
  })();

  /**
   * Best-effort synchronization to ensure backend reflects a locally-solved game.
   * Safe to call repeatedly; server will ignore duplicates or throw which we swallow.
   */
  ensureServerHasWin = async (winning: GuessHistoryItem) => {
    try {
      const res = await submitBatchToServer(challengeNumber, [
        {
          word: winning.word,
          similarity: winning.similarity,
          rank: Number.isFinite(winning.rank) ? winning.rank : -1,
          atMs: winning.timestamp,
        },
      ], waveScope ?? undefined);
      if (res && res.solvedAtMs) {
        const at = Number(res.solvedAtMs) || Date.now();
        solvedAtMs.value = at;
        markSolvedForCurrentChallenge(at);
      }
    } catch {
      // Ignore errors (e.g., duplicate submissions); state will reconcile on next fetch
    }
  };

  // no-op: queue removed; submissions are sent fire-and-forget per guess

  const hasGuessed = (word: string) => guessedSet.has(word);
  // no separate getGuesses; callers can derive from history when needed

  const submit = async (raw: string): Promise<ClientGuessResult> => {
    const now = Date.now();
    if (now - lastSubmitTs < rateLimitMs) {
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'RATE_LIMITED',
        message: "You're going too fast—try again in a moment.",
      };
      lastResult.value = res;
      return res;
    }

    const word = normalizeWord(raw);

    // guards
    if (word.length === 0) {
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'EMPTY',
        message: 'Type a word to guess.',
      };
      lastResult.value = res;
      return res;
    }
    if (word.length < 2) {
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'TOO_SHORT',
        message: 'Please enter at least 2 letters.',
      };
      lastResult.value = res;
      return res;
    }
    if (!isValidWord(word)) {
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'INVALID_CHARS',
        message: 'Only letters are allowed.',
      };
      lastResult.value = res;
      return res;
    }
    if (hasGuessed(word)) {
      // If any prior guess is the winning word, auto-mark solved to recover navigation
      // for returning winners (even if the duplicate isn't the winning word itself).
      const winning = history.value.find((h) => h.similarity === 1);
      if (winning) {
        solvedAtMs.value = winning.timestamp ?? Date.now();
        markSolvedForCurrentChallenge(solvedAtMs.value);
        // Ensure backend reflects the win for leaderboard/stats
        void ensureServerHasWin(winning);
      }
      const alreadyGuessed = history.value.find((h) => h.word === word);
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'DUPLICATE',
        word,
        message: `You already guessed “${word}”. (#${alreadyGuessed?.rank})`,
      };
      lastResult.value = res;
      return res;
    }

    isSubmitting.value = true;
    try {
      // Only start rate-limit window for actual lookups that pass guards
      lastSubmitTs = now;
      const source =
        mode === 'horde' && waveId != null
          ? ({ mode, wave: Number(waveId), challengeNumber } as const)
          : ({ mode, challengeNumber } as const);
      const data = await makeGuess(word, source);
      if (!data) {
        const res: Extract<ClientGuessResult, { ok: false }> = {
          ok: false,
          code: 'NOT_IN_DICTIONARY',
          word,
          message: `I don't recognize “${word}”. Try another word.`,
        };
        lastResult.value = res;
        return res;
      }

      // optimistic: record guess locally and enqueue server submission in background
      const corrected = typeof data.word === 'string' && data.word.length > 0 ? data.word : word;

      // If the lemma-corrected word was already guessed, treat as duplicate
      if (hasGuessed(corrected)) {
        const winning = history.value.find((h) => h.similarity === 1);
        if (winning) {
          solvedAtMs.value = winning.timestamp ?? Date.now();
          markSolvedForCurrentChallenge(solvedAtMs.value);
          // Ensure backend reflects the win for leaderboard/stats
          void ensureServerHasWin(winning);
        }
        const alreadyGuessed = history.value.find((h) => h.word === corrected);
        const res: Extract<ClientGuessResult, { ok: false }> = {
          ok: false,
          code: 'DUPLICATE',
          word: corrected,
          message: `You already guessed “${corrected}”. (#${alreadyGuessed?.rank})`,
        };
        lastResult.value = res;
        return res;
      }
      batch(() => {
        guessedSet.add(corrected);
        sessionGuessedSet.add(corrected);
        const item: GuessHistoryItem = {
          word: corrected,
          similarity: data.similarity,
          rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
          timestamp: now,
          wave: waveScope ?? null,
        };
        history.value = [...history.value, item];
      });

      // Preload scheduler based on distinct guess count this session
      maybeSchedulePreloads();

      // Submit to server
      // - Non-winning guesses: fire-and-forget
      // - Winning guess: block until backend verifies, computes score, and updates leaderboard
      if (data.similarity !== 1) {
        void (async () => {
          try {
            const serverState = await submitBatchToServer(challengeNumber, [
              {
                word: corrected,
                similarity: data.similarity,
                rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
                atMs: now,
              },
            ], waveScope ?? undefined);
            if (serverState && serverState.solvedAtMs) {
              const solvedAt = Number(serverState.solvedAtMs) || Date.now();
              solvedAtMs.value = solvedAt;
              markSolvedForCurrentChallenge(solvedAt);
            }
          } catch {
            // ignore
          }
        })();
      }

      const res: Extract<ClientGuessResult, { ok: true }> = {
        ok: true,
        word: corrected,
        similarity: data.similarity,
        rank: Number.isFinite(data.rank) ? data.rank : null,
      };
      lastResult.value = res;

      // If guessed word is correct locally, block and sync with backend before navigating
      if (data.similarity === 1) {
        try {
          const serverState = await submitBatchToServer(challengeNumber, [
            {
              word: corrected,
              similarity: data.similarity,
              rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
              atMs: now,
            },
          ], waveScope ?? undefined);
          if (serverState && serverState.solvedAtMs) {
            const solvedAt = Number(serverState.solvedAtMs) || now;
            solvedAtMs.value = solvedAt;
            markSolvedForCurrentChallenge(solvedAt);
            try {
              posthog.capture('Solved Word', {
                challengeNumber,
                word: corrected,
                rank: Number.isFinite(data.rank) ? (data.rank as number) : null,
                totalGuesses: history.value.length,
                solvedAtMs: solvedAt,
              });
            } catch {}
          } else {
            // Fallback: mark locally; server will reconcile on next fetch
            solvedAtMs.value = now;
            markSolvedForCurrentChallenge(now);
            void ensureServerHasWin({
              word: corrected,
              similarity: data.similarity,
              rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
              timestamp: now,
              wave: waveScope ?? null,
            });
            try {
              posthog.capture('Solved Word', {
                challengeNumber,
                word: corrected,
                rank: Number.isFinite(data.rank) ? (data.rank as number) : null,
                totalGuesses: history.value.length,
                solvedAtMs: now,
              });
            } catch {}
          }
        } catch {
          // Network/server error – fallback to optimistic local win and background ensure
          solvedAtMs.value = now;
          markSolvedForCurrentChallenge(now);
          void ensureServerHasWin({
            word: corrected,
            similarity: data.similarity,
            rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
            timestamp: now,
            wave: waveScope ?? null,
          });
          try {
            posthog.capture('Solved Word', {
              challengeNumber,
              word: corrected,
              rank: Number.isFinite(data.rank) ? (data.rank as number) : null,
              totalGuesses: history.value.length,
              solvedAtMs: now,
            });
          } catch {}
        }
      }
      return res;
    } catch (e) {
      console.error(e);
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'UNAVAILABLE',
        message: 'Dictionary is unavailable right now. Please try again.',
      };
      lastResult.value = res;
      return res;
    } finally {
      isSubmitting.value = false;
    }
  };

  // Submit a specific word as a hint-triggered guess (client-driven isHint=true)
  const submitHint = async (raw: string): Promise<ClientGuessResult> => {
    const now = Date.now();
    const word = normalizeWord(raw);
    if (hasGuessed(word)) {
      const alreadyGuessed = history.value.find((h) => h.word === word);
      const res: Extract<ClientGuessResult, { ok: false }> = {
        ok: false,
        code: 'DUPLICATE',
        word,
        message: `You already guessed “${word}”. (#${alreadyGuessed?.rank})`,
      };
      lastResult.value = res;
      return res;
    }

    // Look up similarity/rank for the hint word using the same path as free guesses
    try {
      isSubmitting.value = true;
      const source =
        mode === 'horde' && waveId != null
          ? ({ mode, wave: Number(waveId), challengeNumber } as const)
          : ({ mode, challengeNumber } as const);
      const data = await makeGuess(word, source);
      if (!data) {
        const res: Extract<ClientGuessResult, { ok: false }> = {
          ok: false,
          code: 'NOT_IN_DICTIONARY',
          word,
          message: `I don't recognize “${word}”. Try another word.`,
        };
        lastResult.value = res;
        return res;
      }

      const corrected = typeof data.word === 'string' && data.word.length > 0 ? data.word : word;
      if (hasGuessed(corrected)) {
        const alreadyGuessed = history.value.find((h) => h.word === corrected);
        const res: Extract<ClientGuessResult, { ok: false }> = {
          ok: false,
          code: 'DUPLICATE',
          word: corrected,
          message: `You already guessed “${corrected}”. (#${alreadyGuessed?.rank})`,
        };
        lastResult.value = res;
        return res;
      }

      batch(() => {
        history.value = [
          ...history.value,
          {
            word: corrected,
            similarity: data.similarity,
            rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
            timestamp: now,
            wave: waveScope ?? null,
          },
        ];
      });

      // Fire-and-forget to server, marking isHint=true
      void (async () => {
        try {
          const serverState = await submitBatchToServer(challengeNumber, [
            {
              word: corrected,
              similarity: data.similarity,
              rank: Number.isFinite(data.rank) ? (data.rank as number) : -1,
              atMs: now,
              isHint: true,
            },
          ], waveScope ?? undefined);
          if (serverState && serverState.solvedAtMs) {
            const solvedAt = Number(serverState.solvedAtMs) || Date.now();
            solvedAtMs.value = solvedAt;
            markSolvedForCurrentChallenge(solvedAt);
          }
        } catch {
          // ignore
        }
      })();

      const res: Extract<ClientGuessResult, { ok: true }> = {
        ok: true,
        word: corrected,
        similarity: data.similarity,
        rank: Number.isFinite(data.rank) ? data.rank : null,
      };
      lastResult.value = res;
      return res;
    } finally {
      isSubmitting.value = false;
    }
  };

  // removed markSolvedOptimistically; solvedAtMs is set via real events

  const clear = () => {
    batch(() => {
      history.value = [];
      lastResult.value = null;
      isSubmitting.value = false;
      solvedAtMs.value = null;
    });
    guessedSet.clear();
    sessionGuessedSet.clear();
    preloadTierReached = 0;
    letterOrderPromise = null;
  };

  return {
    history,
    lastResult,
    isSubmitting,
    solvedAtMs,
    hasGuessed,
    submit,
    submitHint,
    clear,
  };
}

// Preact-friendly convenience hook
export function useGuessEngine(opts: { challengeNumber: number }) {
  return createGuessEngine(opts);
}

// ---------------------------------------------------------
// Local types
// ---------------------------------------------------------
export type GuessHistoryItem = {
  word: string;
  similarity: number;
  rank: number; // -1 when unknown
  timestamp: number;
  wave?: number | null;
};
