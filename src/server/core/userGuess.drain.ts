import { z } from 'zod';
import { isEmptyObject } from '../../shared/isEmptyObject';
import { getInstallationId } from '../utils';
import { GuessSchema } from '../utils';
import { Challenge } from './challenge';
import { ChallengeProgress } from './challengeProgress';
import { LastPlayedAt } from './lastPlayedAt';
import { redisCompressed as redis } from './redisCompression';
import { Score } from './score';
import { getDrainBatchSize, isDrainDeleteDryRun, isDrainEnabled, isSqlEnabled } from './sqlFlags';
import { User } from './user';
import { UserGuess } from './userGuess';
import { upsertUserGuessRow } from './userGuess.sql';

const CONCURRENT_DRAIN = 50;
const DRAIN_CURSOR_KEY = 'userGuessSql:drain:cursor' as const;
const LAST_PLAYED_CLEANUP_CURSOR_KEY = 'userGuessSql:cleanup:lastPlayed:cursor' as const;
const ZSCAN_COUNT = 200;
const LAST_PLAYED_ZSCAN_COUNT = 100;
const LAST_PLAYED_MIN_ZSCAN_COUNT = 1;
const LAST_PLAYED_MAX_ZSCAN_COUNT = 1_000;
const MAX_RUNTIME_MS = 20_000;
const MIN_SCAN_BUDGET = 2_000;
const SCAN_BUDGET_MULTIPLIER = 100;
const RECENT_PLAY_WINDOW_MS = 3 * 60 * 60 * 1000;

type DrainCandidate = { challengeNumber: number; username: string };
type DrainCursorState = { challengeNumber: number; scanCursor: number };
type CleanupCursorState = { scanCursor: number };
type DrainExecutionOptions = { dryRunDeleteFromRedis: boolean };
type StopReason = 'batch_complete' | 'runtime_budget' | 'scan_budget' | 'full_cycle' | 'completed';
type UserGuessRedisHash = Partial<{
  startedPlayingAtMs: string;
  gaveUpAtMs: string;
  solvedAtMs: string;
  guesses: string;
  score: string;
}> &
  Record<string, string>;

export type DrainJobResult = {
  ok: boolean;
  drained: number;
  candidatesFound: number;
  durationMs: number;
  skippedReason?: string;
};

export type LastPlayedCleanupResult = DrainJobResult & {
  done: boolean;
};

export type LastPlayedCleanupConfig = {
  batchSize?: number;
  zscanCount?: number;
};

function getScanBudget(batchSize: number): number {
  return Math.max(MIN_SCAN_BUDGET, batchSize * SCAN_BUDGET_MULTIPLIER);
}

function normalizeLastPlayedZscanCount(value: number | undefined): number {
  if (value == null) return LAST_PLAYED_ZSCAN_COUNT;
  const intValue = Number.isFinite(value) ? Math.floor(value) : LAST_PLAYED_ZSCAN_COUNT;
  if (intValue < LAST_PLAYED_MIN_ZSCAN_COUNT) return LAST_PLAYED_MIN_ZSCAN_COUNT;
  if (intValue > LAST_PLAYED_MAX_ZSCAN_COUNT) return LAST_PLAYED_MAX_ZSCAN_COUNT;
  return intValue;
}

function formatError(err: unknown): { message: string; stack?: string; cause?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      ...(err.stack != null && { stack: err.stack }),
      ...(err.cause != null && {
        cause: err.cause instanceof Error ? err.cause.message : String(err.cause),
      }),
    };
  }
  return { message: String(err) };
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getLatestGuessTimestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    let latest: number | undefined;
    for (const guess of parsed) {
      const maybeTimestampMs =
        guess &&
        typeof guess === 'object' &&
        'timestampMs' in guess &&
        typeof (guess as { timestampMs?: unknown }).timestampMs === 'number'
          ? (guess as { timestampMs: number }).timestampMs
          : undefined;
      if (maybeTimestampMs == null || !Number.isFinite(maybeTimestampMs)) continue;
      latest = latest == null ? maybeTimestampMs : Math.max(latest, maybeTimestampMs);
    }
    return latest;
  } catch {
    return undefined;
  }
}

function isActivelyPlayingRecord(data: UserGuessRedisHash, cutoffMs: number): boolean {
  const solvedAtMs = parseOptionalInt(data.solvedAtMs);
  const gaveUpAtMs = parseOptionalInt(data.gaveUpAtMs);
  if (solvedAtMs != null || gaveUpAtMs != null) return false;

  const startedPlayingAtMs = parseOptionalInt(data.startedPlayingAtMs);
  if (startedPlayingAtMs != null && startedPlayingAtMs > cutoffMs) return true;

  const latestGuessAtMs = getLatestGuessTimestampMs(data.guesses);
  return latestGuessAtMs != null && latestGuessAtMs > cutoffMs;
}

async function loadDrainCursor(currentChallenge: number): Promise<DrainCursorState> {
  const fallback: DrainCursorState = {
    challengeNumber: currentChallenge,
    scanCursor: 0,
  };
  if (currentChallenge < 1) return fallback;

  const raw = await redis.get(DRAIN_CURSOR_KEY);
  if (!raw) return fallback;

  try {
    const parsed = z
      .object({
        challengeNumber: z.number().int().optional(),
        scanCursor: z.number().int().min(0),
      })
      .passthrough()
      .parse(JSON.parse(raw));
    return {
      challengeNumber: Math.min(
        currentChallenge,
        Math.max(1, parsed.challengeNumber ?? currentChallenge)
      ),
      scanCursor: parsed.scanCursor,
    };
  } catch {
    return fallback;
  }
}

async function saveDrainCursor(state: DrainCursorState): Promise<void> {
  await redis.set(DRAIN_CURSOR_KEY, JSON.stringify(state));
}

async function loadCleanupCursor(): Promise<CleanupCursorState> {
  const fallback: CleanupCursorState = { scanCursor: 0 };
  const raw = await redis.get(LAST_PLAYED_CLEANUP_CURSOR_KEY);
  if (!raw) return fallback;

  try {
    const parsed = z
      .object({
        scanCursor: z.number().int().min(0),
      })
      .parse(JSON.parse(raw));
    return { scanCursor: parsed.scanCursor };
  } catch {
    return fallback;
  }
}

async function saveCleanupCursor(state: CleanupCursorState): Promise<void> {
  await redis.set(LAST_PLAYED_CLEANUP_CURSOR_KEY, JSON.stringify(state));
}

export async function resetLastPlayedCleanupCursor(): Promise<void> {
  await redis.del(LAST_PLAYED_CLEANUP_CURSOR_KEY);
}

/**
 * Drain one Redis user-guess key: read -> write to SQL -> delete from Redis.
 */
async function drainOneKey(candidate: DrainCandidate, options: DrainExecutionOptions): Promise<boolean> {
  const { challengeNumber, username } = candidate;
  const key = UserGuess.Key(challengeNumber, username);
  const raw = await redis.hGetAll(key);
  if (!raw || isEmptyObject(raw)) return false;

  const startedPlayingAtMs = raw.startedPlayingAtMs
    ? Number.parseInt(raw.startedPlayingAtMs, 10)
    : undefined;
  const gaveUpAtMs = raw.gaveUpAtMs ? Number.parseInt(raw.gaveUpAtMs, 10) : undefined;
  const solvedAtMs = raw.solvedAtMs ? Number.parseInt(raw.solvedAtMs, 10) : undefined;

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

  if (options.dryRunDeleteFromRedis) return true;
  await redis.del(key);
  return true;
}

async function drainCandidatesBatch(
  candidates: DrainCandidate[],
  options: DrainExecutionOptions
): Promise<number> {
  let drained = 0;
  for (let i = 0; i < candidates.length; i += CONCURRENT_DRAIN) {
    const batch = candidates.slice(i, i + CONCURRENT_DRAIN);
    const results = await Promise.allSettled(batch.map((c) => drainOneKey(c, options)));
    results.forEach((result, j) => {
      const candidate = batch[j];
      if (result.status === 'fulfilled' && result.value) {
        drained++;
      } else if (result.status === 'rejected' && candidate) {
        console.error('[user guess drain] drain failed', {
          challengeNumber: candidate.challengeNumber,
          username: candidate.username,
          ...formatError(result.reason),
        });
      }
    });
  }
  return drained;
}

async function findCandidatesFromProgressScan(params: {
  challengeNumber: number;
  members: { member: string; score: number }[];
  remaining: number;
  cutoffMs: number;
}): Promise<DrainCandidate[]> {
  const { challengeNumber, members, remaining, cutoffMs } = params;
  if (remaining <= 0 || members.length === 0) return [];

  const checks = await Promise.all(
    members.map(async (m) => {
      const key = UserGuess.Key(challengeNumber, m.member);
      const data = await redis.hGetAll(key);
      if (!data || isEmptyObject(data)) return null;
      if (isActivelyPlayingRecord(data, cutoffMs)) return null;
      return { challengeNumber, username: m.member } as DrainCandidate;
    })
  );

  const candidates: DrainCandidate[] = [];
  for (const candidate of checks) {
    if (!candidate) continue;
    candidates.push(candidate);
    if (candidates.length >= remaining) break;
  }
  return candidates;
}

/**
 * Scheduled drain path: discover candidates from ChallengeProgress index and
 * skip users that appear actively in-progress for that challenge key.
 */
export async function runDrainJob(): Promise<DrainJobResult> {
  const startMs = Date.now();

  const [drainEnabled, sqlEnabled, dryRunDeleteFromRedis] = await Promise.all([
    isDrainEnabled(),
    isSqlEnabled(),
    isDrainDeleteDryRun(),
  ]);

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
  const currentChallenge = await Challenge.getCurrentChallengeNumber();
  if (currentChallenge < 1) {
    console.log('[user guess drain] skipped: no challenges');
    return {
      ok: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'no challenges',
    };
  }

  const scanBudget = getScanBudget(batchSize);
  const cutoffMs = Date.now() - RECENT_PLAY_WINDOW_MS;
  let cursor = await loadDrainCursor(currentChallenge);
  const cursorStart = { ...cursor };

  console.log('[user guess drain] start', {
    batchSize,
    currentChallenge,
    cursorStart,
    scanBudget,
    zscanCount: ZSCAN_COUNT,
    cutoffMs,
    dryRunDeleteFromRedis,
  });

  const drainStart = Date.now();
  let drained = 0;
  let candidatesFound = 0;
  let scannedMembers = 0;
  let scannedChallenges = 0;
  let scanCalls = 0;
  let stopReason: StopReason = 'batch_complete';

  while (drained < batchSize) {
    if (Date.now() - startMs > MAX_RUNTIME_MS) {
      stopReason = 'runtime_budget';
      break;
    }
    if (scannedMembers >= scanBudget) {
      stopReason = 'scan_budget';
      break;
    }

    const startKey = ChallengeProgress.StartKey(cursor.challengeNumber);
    const { cursor: nextScanCursor, members } = await redis.zScan(
      startKey,
      cursor.scanCursor,
      undefined,
      ZSCAN_COUNT
    );

    scanCalls++;
    scannedMembers += members.length;

    const remaining = batchSize - drained;
    const candidates = await findCandidatesFromProgressScan({
      challengeNumber: cursor.challengeNumber,
      members,
      remaining,
      cutoffMs,
    });

    candidatesFound += candidates.length;
    if (candidates.length > 0) {
      drained += await drainCandidatesBatch(candidates, { dryRunDeleteFromRedis });
    }

    if (nextScanCursor === 0) {
      scannedChallenges++;
      cursor = {
        challengeNumber:
          cursor.challengeNumber >= currentChallenge ? 1 : cursor.challengeNumber + 1,
        scanCursor: 0,
      };
    } else {
      cursor = { ...cursor, scanCursor: nextScanCursor };
    }

    if (
      cursor.challengeNumber === cursorStart.challengeNumber &&
      cursor.scanCursor === cursorStart.scanCursor
    ) {
      stopReason = 'full_cycle';
      break;
    }
  }

  await saveDrainCursor(cursor);

  const durationMs = Date.now() - startMs;
  const drainMs = Date.now() - drainStart;
  console.log('[user guess drain] done', {
    drained,
    candidatesFound,
    scannedMembers,
    scannedChallenges,
    scanCalls,
    cursorEnd: cursor,
    stopReason,
    drainMs,
    durationMs,
  });

  return {
    ok: true,
    drained,
    candidatesFound,
    durationMs,
  };
}

/**
 * One cleanup step (manual daisy-chain): iterate users from last_played_at and
 * check every challenge number for lingering user-guess keys.
 */
export async function runLastPlayedCleanupStep(
  config?: LastPlayedCleanupConfig
): Promise<LastPlayedCleanupResult> {
  const startMs = Date.now();
  const cutoffMs = Date.now() - RECENT_PLAY_WINDOW_MS;

  const [sqlEnabled, dryRunDeleteFromRedis] = await Promise.all([
    isSqlEnabled(),
    isDrainDeleteDryRun(),
  ]);
  if (!sqlEnabled) {
    return {
      ok: true,
      done: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'SQL disabled',
    };
  }

  const defaultBatchSize = await getDrainBatchSize();
  const batchSize =
    config?.batchSize != null && Number.isFinite(config.batchSize) && config.batchSize >= 1
      ? Math.floor(config.batchSize)
      : defaultBatchSize;
  const zscanCount = normalizeLastPlayedZscanCount(config?.zscanCount);
  const currentChallenge = await Challenge.getCurrentChallengeNumber();
  if (currentChallenge < 1) {
    return {
      ok: true,
      done: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'no challenges',
    };
  }

  const totalUsers = await LastPlayedAt.totalLastPlayedUsers();
  if (totalUsers === 0) {
    return {
      ok: true,
      done: true,
      drained: 0,
      candidatesFound: 0,
      durationMs: Date.now() - startMs,
      skippedReason: 'no users',
    };
  }

  let cursor = await loadCleanupCursor();
  const scanBudget = getScanBudget(batchSize);
  const cursorStart = { ...cursor };

  console.log('[user guess drain] cleanup start', {
    batchSize,
    usersLength: totalUsers,
    currentChallenge,
    cursorStart,
    scanBudget,
    zscanCount,
    dryRunDeleteFromRedis,
  });

  let drained = 0;
  let candidatesFound = 0;
  let scannedKeys = 0;
  let scannedUsers = 0;
  let scanCalls = 0;
  let stopReason: StopReason = 'batch_complete';
  let done = false;

  while (drained < batchSize) {
    if (Date.now() - startMs > MAX_RUNTIME_MS) {
      stopReason = 'runtime_budget';
      break;
    }
    if (scannedKeys >= scanBudget) {
      stopReason = 'scan_budget';
      break;
    }

    const scanned = await LastPlayedAt.scanUsernames({
      cursor: cursor.scanCursor,
      count: zscanCount,
    });
    scanCalls++;
    scannedUsers += scanned.members.length;

    if (scanned.members.length === 0) {
      cursor = { scanCursor: scanned.cursor };
      if (scanned.cursor === 0) {
        done = true;
        stopReason = 'full_cycle';
      }
      break;
    }

    const candidatesInScan: DrainCandidate[] = [];
    let fullyProcessedScan = true;

    for (const username of scanned.members) {
      for (let challengeNumber = 1; challengeNumber <= currentChallenge; challengeNumber++) {
        if (Date.now() - startMs > MAX_RUNTIME_MS) {
          stopReason = 'runtime_budget';
          fullyProcessedScan = false;
          break;
        }
        if (scannedKeys >= scanBudget) {
          stopReason = 'scan_budget';
          fullyProcessedScan = false;
          break;
        }

        const key = UserGuess.Key(challengeNumber, username);
        const data = await redis.hGetAll(key);
        scannedKeys++;
        if (data && !isEmptyObject(data)) {
          if (isActivelyPlayingRecord(data, cutoffMs)) {
            continue;
          }
          candidatesInScan.push({ challengeNumber, username });
          candidatesFound++;
        }
      }
      if (!fullyProcessedScan) break;
    }

    const remaining = batchSize - drained;
    const candidatesToDrain = candidatesInScan.slice(0, remaining);
    const deferredCandidates = candidatesInScan.length - candidatesToDrain.length;
    if (candidatesToDrain.length > 0) {
      drained += await drainCandidatesBatch(candidatesToDrain, { dryRunDeleteFromRedis });
    }
    if (deferredCandidates > 0) {
      fullyProcessedScan = false;
      stopReason = 'batch_complete';
    }

    if (!fullyProcessedScan) break;

    cursor = { scanCursor: scanned.cursor };
    if (cursor.scanCursor === 0) {
      done = true;
      stopReason = 'full_cycle';
      break;
    }

    if (drained >= batchSize) {
      stopReason = 'batch_complete';
      break;
    }
  }

  if (done) {
    await resetLastPlayedCleanupCursor();
  } else {
    await saveCleanupCursor(cursor);
  }

  const durationMs = Date.now() - startMs;
  console.log('[user guess drain] cleanup done', {
    drained,
    candidatesFound,
    scannedKeys,
    scannedUsers,
    scanCalls,
    cursorEnd: cursor,
    stopReason,
    done,
    durationMs,
  });

  return {
    ok: true,
    done,
    drained,
    candidatesFound,
    durationMs,
  };
}
