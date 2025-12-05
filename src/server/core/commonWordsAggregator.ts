import { redis, scheduler, reddit } from '@devvit/web/server';
import { redisCompressed } from './redisCompression';
import { UserGuess } from './userGuess';

export namespace CommonWordsAggregator {
  const JOB_STATE_KEY = 'commonWords:job:state';
  const JOB_CANCEL_SIGNAL_KEY = 'commonWords:job:cancelSignal';
  const COUNTS_KEY = 'commonWords:job:counts'; // ZSET: member=word, score=count
  const TTL_SECONDS = 60 * 60 * 24 * 3; // 3 days

  type JobState = {
    status: 'running' | 'cancelled' | 'done' | 'idle';
    startChallenge: number;
    endChallenge: number;
    currentChallenge: number;
    cursor: number; // for zScan
    initiatorUsername: string;
    jobId: string;
    startTime: number;
    totalProcessed: number;
    totalSkipped: number;
    processedInCurrentChallenge: number;
    lastHeartbeat?: number;
  };

  export async function startJob(params: {
    startChallenge: number;
    endChallenge: number;
    initiatorUsername: string;
  }) {
    const { startChallenge, endChallenge, initiatorUsername } = params;
    const jobId = Math.random().toString(36).substring(2, 15);

    const state: JobState = {
      status: 'running',
      startChallenge,
      endChallenge,
      currentChallenge: startChallenge,
      cursor: 0,
      initiatorUsername,
      jobId,
      startTime: Date.now(),
      totalProcessed: 0,
      totalSkipped: 0,
      processedInCurrentChallenge: 0,
      lastHeartbeat: Date.now(),
    };

    // Clear previous counts and signal
    await redis.del(COUNTS_KEY);
    await redis.del(JOB_CANCEL_SIGNAL_KEY);

    // Set new state
    await redis.set(JOB_STATE_KEY, JSON.stringify(state));

    // Set expiry for cleanup
    await redis.expire(JOB_STATE_KEY, TTL_SECONDS);
    await redis.expire(COUNTS_KEY, TTL_SECONDS);

    console.log('[CommonWords] Started job', { jobId, startChallenge, endChallenge });

    // Kick off the first batch
    await scheduler.runJob({
      name: 'common-words-aggregator',
      runAt: new Date(),
      data: {},
    });

    return { jobId };
  }

  export async function cancelJob() {
    // Signal cancellation to any running process
    await redis.set(JOB_CANCEL_SIGNAL_KEY, '1');
    await redis.expire(JOB_CANCEL_SIGNAL_KEY, 60 * 60); // 1 hour expiry

    const stateStr = await redis.get(JOB_STATE_KEY);
    if (!stateStr) return false;

    const state = JSON.parse(stateStr) as JobState;

    // Force status to cancelled regardless of current status (to stop watchdog/pending)
    state.status = 'cancelled';
    await redis.set(JOB_STATE_KEY, JSON.stringify(state));
    console.log('[CommonWords] Job cancelled by user request');

    return true;
  }

  export async function getJobState(): Promise<JobState | null> {
    const stateStr = await redis.get(JOB_STATE_KEY);
    return stateStr ? (JSON.parse(stateStr) as JobState) : null;
  }

  /**
   * Main processing loop. Returns true if finished (or cancelled), false if needs requeue.
   */
  export async function processBatch(timeLimitMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const stateStr = await redis.get(JOB_STATE_KEY);
    if (!stateStr) {
      console.log('[CommonWords] No job state found, stopping.');
      return true;
    }

    const state = JSON.parse(stateStr) as JobState;

    // Check for external cancellation signal first
    const cancelSignal = await redis.get(JOB_CANCEL_SIGNAL_KEY);
    if (cancelSignal) {
      console.log('[CommonWords] Cancellation signal detected. Stopping batch.');
      if (state.status !== 'cancelled') {
        state.status = 'cancelled';
        await redis.set(JOB_STATE_KEY, JSON.stringify(state));
      }
      return true;
    }

    if (state.status !== 'running') {
      console.log('[CommonWords] Job not running (status=' + state.status + '), stopping.');
      return true;
    }

    console.log('[CommonWords] Resuming batch', {
      jobId: state.jobId,
      currentChallenge: state.currentChallenge,
      cursor: state.cursor,
      totalProcessed: state.totalProcessed,
    });

    // Update heartbeat
    state.lastHeartbeat = Date.now();
    await redis.set(JOB_STATE_KEY, JSON.stringify(state));

    try {
      while (Date.now() - startTime < timeLimitMs) {
        if (state.currentChallenge > state.endChallenge) {
          // We are done!
          await finishJob(state);
          return true;
        }

        // Process current challenge
        const challengeNum = state.currentChallenge;

        const startKey = `challenge:${challengeNum}:leaderboard:score`;

        // Scan users
        const { cursor: nextCursor, members } = await redis.zScan(
          startKey,
          state.cursor,
          undefined,
          200
        );

        if (members.length > 0) {
          const usernames = members.map((m) => m.member);

          const batchCounts = new Map<string, number>();

          // Process each user's guesses
          await Promise.allSettled(
            usernames.map(async (username) => {
              try {
                const userKey = UserGuess.Key(challengeNum, username);
                const data = await redisCompressed.hGetAll(userKey);

                if (data && data.guesses) {
                  let guesses: any[] = [];
                  try {
                    guesses = JSON.parse(data.guesses);
                  } catch {
                    // ignore
                  }

                  if (Array.isArray(guesses)) {
                    // Double check winner status (though leaderboard implies it)
                    if (!data.solvedAtMs) {
                      return; // Skip if not solved (shouldn't happen if source is leaderboard)
                    }

                    // ONLY count the first guess
                    const firstGuess = guesses[0];
                    if (
                      firstGuess &&
                      typeof firstGuess.word === 'string' &&
                      // Filter out hints if the first guess was a hint (rare but possible)
                      !firstGuess.isHint
                    ) {
                      const w = firstGuess.word.toLowerCase().trim();
                      if (w) {
                        batchCounts.set(w, (batchCounts.get(w) || 0) + 1);
                      }
                    }
                  }
                }
              } catch (e) {
                console.error(
                  `[CommonWords] Error processing user ${username} in challenge ${challengeNum}`,
                  e
                );
                state.totalSkipped++;
              }
            })
          );

          // Flush aggregated counts to Redis ZSET
          const updates = Array.from(batchCounts.entries());
          await Promise.allSettled(
            updates.map(([word, count]) => redis.zIncrBy(COUNTS_KEY, word, count))
          );

          state.totalProcessed += members.length;
          state.processedInCurrentChallenge += members.length;
        }

        // Update cursor
        if (nextCursor === 0) {
          // Finished this challenge
          console.log(
            `[CommonWords] Finished challenge ${challengeNum}. Processed ${state.processedInCurrentChallenge} users.`
          );
          state.currentChallenge++;
          state.cursor = 0;
          state.processedInCurrentChallenge = 0;
        } else {
          state.cursor = nextCursor;
        }
      }

      // Time limit reached, save state and return false (requeue)
      // Double check cancellation before writing back state
      const finalCancelCheck = await redis.get(JOB_CANCEL_SIGNAL_KEY);
      if (finalCancelCheck) {
        console.log('[CommonWords] Cancellation signal detected during batch. Aborting save.');
        state.status = 'cancelled';
        await redis.set(JOB_STATE_KEY, JSON.stringify(state));
        return true;
      }

      await redis.set(JOB_STATE_KEY, JSON.stringify(state));
      // Extend expiry to keep alive
      await redis.expire(JOB_STATE_KEY, TTL_SECONDS);
      await redis.expire(COUNTS_KEY, TTL_SECONDS);

      console.log('[CommonWords] Batch time limit reached, requeueing.', {
        nextChallenge: state.currentChallenge,
        nextCursor: state.cursor,
      });

      return false;
    } catch (error: any) {
      console.error('[CommonWords] Fatal error in batch', error);
      // Let's abort to be safe
      state.status = 'cancelled';
      await redis.set(JOB_STATE_KEY, JSON.stringify(state));
      return true;
    }
  }

  async function finishJob(state: JobState) {
    state.status = 'done';
    await redis.set(JOB_STATE_KEY, JSON.stringify(state));
    await redis.expire(JOB_STATE_KEY, TTL_SECONDS);
    await redis.expire(COUNTS_KEY, TTL_SECONDS);

    console.log('[CommonWords] Job finishing. Fetching top words...');

    // Get top 25 words
    const top25 = await redis.zRange(COUNTS_KEY, 0, 24, { by: 'rank', reverse: true });

    const lines = [
      `Common Words Analysis Complete! (First guess only, Winners only)`,
      `Challenges: ${state.startChallenge} - ${state.endChallenge}`,
      `Total users processed: ${state.totalProcessed}`,
      ``,
      `Top 25 Words:`,
    ];

    top25.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.member} (${entry.score})`);
    });

    // Send DM
    const currentUser = await reddit.getUserByUsername(state.initiatorUsername);
    if (currentUser) {
      await reddit.sendPrivateMessage({
        to: currentUser.username,
        subject: 'Common Words Analysis Results',
        text: lines.join('\n'),
      });
    }

    console.log('[CommonWords] Job finished and DM sent.');
  }

  export async function checkHealthAndRestart(
    maxAgeMs: number = 1000 * 60 * 10
  ): Promise<{ restarted: boolean; age?: number }> {
    const stateStr = await redis.get(JOB_STATE_KEY);
    if (!stateStr) return { restarted: false };

    const state = JSON.parse(stateStr) as JobState;
    if (state.status !== 'running') return { restarted: false };

    const now = Date.now();
    const lastHeartbeat = state.lastHeartbeat ?? state.startTime;
    const age = now - lastHeartbeat;

    if (age > maxAgeMs) {
      console.warn(
        `[CommonWords] Job ${state.jobId} appears stuck (last heartbeat ${age}ms ago). Restarting...`
      );

      // Requeue
      await scheduler.runJob({
        name: 'common-words-aggregator',
        runAt: new Date(),
        data: {},
      });

      // Update heartbeat to prevent immediate re-restart loop if queue is just slow
      state.lastHeartbeat = now;
      await redis.set(JOB_STATE_KEY, JSON.stringify(state));
      return { restarted: true, age };
    }
    return { restarted: false, age };
  }
}
