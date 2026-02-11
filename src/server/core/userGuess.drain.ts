import { z } from 'zod';
import { isEmptyObject } from '../../shared/isEmptyObject';
import { getInstallationId } from '../utils';
import { GuessSchema } from '../utils';
import { Challenge } from './challenge';
import { LastPlayedAt } from './lastPlayedAt';
import { redisCompressed as redis } from './redisCompression';
import { Score } from './score';
import { getDrainBatchSize, isDrainEnabled, isSqlEnabled } from './sqlFlags';
import { User } from './user';
import { UserGuess } from './userGuess';
import { upsertUserGuessRow } from './userGuess.sql';

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const MAX_CHALLENGES_TO_SCAN_PER_USER = 200;
const CONCURRENT_DRAIN = 50;

type DrainCandidate = { challengeNumber: number; username: string };

/**
 * Collect (challengeNumber, username) pairs to drain: user has Redis data and
 * hasn't played in the last 3 hours.
 */
async function collectDrainCandidates(batchSize: number): Promise<DrainCandidate[]> {
  const cutoffMs = Date.now() - THREE_HOURS_MS;
  const usernames = await LastPlayedAt.getUsernamesNotPlayedSince({
    cutoffMs,
    limit: Math.min(500, batchSize * 2),
  });
  if (usernames.length === 0) {
    return [];
  }

  const currentChallenge = await Challenge.getCurrentChallengeNumber();
  if (currentChallenge < 1) return [];
  const maxChallenge = Math.min(currentChallenge, MAX_CHALLENGES_TO_SCAN_PER_USER);
  const candidates: DrainCandidate[] = [];

  for (const username of usernames) {
    if (candidates.length >= batchSize) break;

    for (let cn = 1; cn <= maxChallenge; cn++) {
      if (candidates.length >= batchSize) break;
      const key = UserGuess.Key(cn, username);
      const data = await redis.hGetAll(key);
      if (data && !isEmptyObject(data)) {
        candidates.push({ challengeNumber: cn, username });
      }
    }
  }

  return candidates;
}

/**
 * Drain one Redis user-guess key: read → write to SQL → delete from Redis.
 */
async function drainOneKey(candidate: DrainCandidate): Promise<void> {
  const { challengeNumber, username } = candidate;
  const key = UserGuess.Key(challengeNumber, username);
  const raw = await redis.hGetAll(key);
  if (!raw || isEmptyObject(raw)) return;

  const startedPlayingAtMs = raw.startedPlayingAtMs
    ? Number.parseInt(raw.startedPlayingAtMs, 10)
    : undefined;
  const gaveUpAtMs = raw.gaveUpAtMs ? Number.parseInt(raw.gaveUpAtMs, 10) : undefined;
  const solvedAtMs = raw.solvedAtMs ? Number.parseInt(raw.solvedAtMs, 10) : undefined;
  // JSON.parse throws if the value is invalid JSON (e.g. corrupted/truncated Redis value, legacy format).
  let guesses: unknown = [];
  try {
    guesses = JSON.parse(raw.guesses ?? '[]');
  } catch {
    guesses = [];
  }
  let scoreParsed: z.infer<typeof Score.Info> | null = null;
  if (raw.score) {
    try {
      const parsed = JSON.parse(raw.score) as unknown;
      const result = Score.Info.safeParse(parsed);
      if (result.success) scoreParsed = result.data;
    } catch {
      // ignore invalid score
    }
  }

  const installationIdValue = getInstallationId();
  const maskedUserId = await User.getOrCreateMaskedId(username);

  const guessesArray = Array.isArray(guesses) ? guesses : [];
  const guessesValid = z.array(GuessSchema).safeParse(guessesArray);
  const guessesToWrite = guessesValid.success ? guessesValid.data : [];

  await upsertUserGuessRow({
    installationIdValue,
    challengeNumber,
    userId: maskedUserId,
    startedPlayingAt: startedPlayingAtMs ? new Date(startedPlayingAtMs) : null,
    gaveUpAt: gaveUpAtMs ? new Date(gaveUpAtMs) : null,
    solvedAt: solvedAtMs ? new Date(solvedAtMs) : null,
    guesses: guessesToWrite,
    score: scoreParsed,
  });

  await redis.del(key);
}

export type DrainJobResult = {
  ok: boolean;
  drained: number;
  candidatesFound: number;
  durationMs: number;
  skippedReason?: string;
};

/**
 * Run one drain job: collect candidates (users not played in 3h), write to SQL, delete from Redis.
 * Respects feature flags; no-op if drain or SQL disabled. Logs with [user guess drain] prefix.
 */
export async function runDrainJob(): Promise<DrainJobResult> {
  const startMs = Date.now();

  const [drainEnabled, sqlEnabled] = await Promise.all([isDrainEnabled(), isSqlEnabled()]);

  if (!drainEnabled) {
    console.log('[user guess drain] skipped: drain disabled');
    return {
      ok: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'drain disabled',
    };
  }

  if (!sqlEnabled) {
    console.log('[user guess drain] skipped: SQL disabled');
    return {
      ok: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'SQL disabled',
    };
  }

  const batchSize = await getDrainBatchSize();
  console.log('[user guess drain] start', { batchSize });

  const collectStart = Date.now();
  const candidates = await collectDrainCandidates(batchSize);
  const collectMs = Date.now() - collectStart;
  console.log('[user guess drain] candidates', {
    count: candidates.length,
    collectMs,
  });

  const drainStart = Date.now();
  let drained = 0;
  for (let i = 0; i < candidates.length; i += CONCURRENT_DRAIN) {
    const batch = candidates.slice(i, i + CONCURRENT_DRAIN);
    const results = await Promise.allSettled(batch.map((c) => drainOneKey(c)));
    results.forEach((result, j) => {
      const candidate = batch[j];
      if (result.status === 'fulfilled') {
        drained++;
      } else if (candidate) {
        const err = result.reason;
        const errObj =
          err instanceof Error
            ? {
                message: err.message,
                stack: err.stack,
                ...(err.cause != null && { cause: err.cause instanceof Error ? err.cause.message : String(err.cause) }),
              }
            : { message: String(err) };
        console.error('[user guess drain] drain failed', {
          challengeNumber: candidate.challengeNumber,
          username: candidate.username,
          ...errObj,
        });
      }
    });
  }
  const drainMs = Date.now() - drainStart;

  const durationMs = Date.now() - startMs;
  console.log('[user guess drain] done', {
    drained,
    candidatesFound: candidates.length,
    drainMs,
    durationMs,
  });

  return {
    ok: true,
    drained,
    candidatesFound: candidates.length,
    durationMs,
  };
}
