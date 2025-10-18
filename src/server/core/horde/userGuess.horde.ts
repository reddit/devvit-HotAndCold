import { z } from 'zod';
import { fn } from '../../../shared/fn';
import { redis } from '@devvit/web/server';
import {
  zodRedditUsername,
  ChallengeUserInfoSchema,
  GameResponseSchema,
  GuessSchema,
} from '../../utils';
import { Challenge } from './challenge.horde';
import { isEmptyObject } from '../../../shared/isEmptyObject';
import { User } from '../user';
import { HordeGuess } from './guess.horde';
import { realtime } from '@devvit/web/server';
import { hordeChannelName, type HordeMessage } from '../../../shared/realtime.horde';

export namespace HordeUserGuess {
  export const Key = (challengeNumber: number, username: string) =>
    `${Challenge.ChallengeKey(challengeNumber)}:user:${username}` as const;

  const maybeInitForUser = fn(
    z.object({ username: zodRedditUsername, challengeNumber: z.number().gt(0) }),
    async ({ username, challengeNumber }) => {
      const result = await redis.hGetAll(Key(challengeNumber, username));
      if (!result || isEmptyObject(result)) {
        await redis.hSet(Key(challengeNumber, username), {
          username,
          guesses: '[]',
        });
      }
    }
  );

  export const getChallengeUserInfo = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      const result = await redis.hGetAll(Key(challengeNumber, username));

      const parseFrom = (raw: Record<string, string>) => {
        const startedPlayingAtMs = raw.startedPlayingAtMs
          ? Number.parseInt(raw.startedPlayingAtMs)
          : undefined;
        const gaveUpAtMs = raw.gaveUpAtMs ? Number.parseInt(raw.gaveUpAtMs) : undefined;
        const solvedAtMs = raw.solvedAtMs ? Number.parseInt(raw.solvedAtMs) : undefined;

        let guessesParsed: unknown = [];
        try {
          guessesParsed = JSON.parse(raw.guesses ?? '[]');
        } catch {
          guessesParsed = [];
        }

        return ChallengeUserInfoSchema.parse({
          username,
          startedPlayingAtMs,
          gaveUpAtMs,
          solvedAtMs,
          guesses: guessesParsed,
        });
      };

      if (result && !isEmptyObject(result)) {
        return parseFrom(result);
      }

      return ChallengeUserInfoSchema.parse({ username, guesses: [] });
    }
  );

  export const giveUp = fn(
    z.object({ username: zodRedditUsername, challengeNumber: z.number().gt(0) }),
    async ({ username, challengeNumber }) => {
      await maybeInitForUser({ username, challengeNumber });
      const challengeInfo = await Challenge.getChallenge({ challengeNumber });
      const currentUserInfo = await getChallengeUserInfo({ username, challengeNumber });

      // If they have never started, mark started + increment players
      if (!currentUserInfo.startedPlayingAtMs) {
        await redis.hSet(Key(challengeNumber, username), {
          startedPlayingAtMs: Date.now().toString(),
        });
        await Challenge.incrementChallengeTotalPlayers({ challengeNumber });
      }

      const now = Date.now();
      // In HORDE mode there is no single secret target to reveal; just mark gave up
      await redis.hSet(Key(challengeNumber, username), {
        gaveUpAtMs: now.toString(),
      });

      const updated = await getChallengeUserInfo({ username, challengeNumber });

      return {
        challengeNumber,
        challengeUserInfo: updated,
        challengeInfo,
      } as z.infer<typeof GameResponseSchema>;
    }
  );

  export const submitGuesses = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
      wave: z.number().int().min(1).optional(),
      guesses: z.array(
        z.object({
          word: z.string().trim().toLowerCase(),
          similarity: z.number(),
          rank: z.number(),
          isHint: z.boolean().optional(),
        })
      ),
    }),
    async ({ username, challengeNumber, wave, guesses: rawGuesses }) => {
      if (rawGuesses.length === 0) throw new Error('Must provide at least one guess');

      await maybeInitForUser({ username, challengeNumber });

      let challengeUserInfo = await getChallengeUserInfo({ username, challengeNumber });
      let challengeInfo = await Challenge.getChallenge({ challengeNumber });

      const toWaveNumber = (value: unknown): number => {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 1) return 1;
        return Math.floor(num);
      };

      // Use the caller-provided wave if available to avoid races in realtime
      const batchWave = wave != null ? toWaveNumber(wave) : toWaveNumber(challengeInfo.currentHordeLevel);

      for (const raw of rawGuesses) {
        const { word, similarity, rank } = raw;
        const currentWaveForGuess = batchWave;

        // First-ever guess bookkeeping
        if (!challengeUserInfo.startedPlayingAtMs) {
          const started = Date.now();
          await Challenge.incrementChallengeTotalPlayers({ challengeNumber });
          await redis.hSet(Key(challengeNumber, username), {
            startedPlayingAtMs: started.toString(),
          });
          // No progress service in HORDE
          void (await User.getCurrent());
        }

        // Prevent duplicates for this user
        if (
          (challengeUserInfo.guesses ?? []).some((g) => {
            const guessWave = toWaveNumber(g.wave ?? 1);
            return g.word === word && guessWave === currentWaveForGuess;
          })
        ) {
          throw new Error(`You already guessed ${word}.`);
        }

        await Challenge.incrementChallengeTotalGuesses({ challengeNumber });
        // Track per-user guess count for leaderboard
        await HordeGuess.incrementGuesserCount({
          challengeNumber,
          username,
        });

        const guessToAdd: z.infer<typeof GuessSchema> = {
          word,
          timestampMs: Date.now(),
          similarity,
          rank: Number.isFinite(rank) ? rank : -1,
          isHint: raw.isHint === true,
          wave: currentWaveForGuess,
        };

        const newGuesses = z
          .array(GuessSchema)
          .parse([...(challengeUserInfo.guesses ?? []), guessToAdd]);
        await redis.hSet(Key(challengeNumber, username), { guesses: JSON.stringify(newGuesses) });

        // Update global HORDE aggregates and per-wave aggregates
        await HordeGuess.add({ challengeNumber, word, username, rank, similarity });
        await HordeGuess.addWave({
          challengeNumber,
          wave: currentWaveForGuess,
          word,
          username,
          rank,
          similarity,
        });

        // If this was the secret for the current wave, record winner and emit wave_cleared
        if (similarity === 1) {
          // Only accept win if the guess matches the current wave's word
          const currentLevel = currentWaveForGuess;
          const target = challengeInfo.words?.[currentLevel - 1];
          if (target && target.toLowerCase() === word.toLowerCase()) {
            // Atomic-ish: re-read level and set winner for that wave index only if unset
            const refreshed = await Challenge.getChallenge({ challengeNumber });
            const liveLevel = Number(refreshed.currentHordeLevel ?? currentLevel);
            // Only proceed if the live wave matches the batch wave to avoid races
            if (liveLevel !== currentLevel) {
              // Treat as a normal guess; do not clear
            } else {
              const waveIdx = Math.max(1, liveLevel);
              const winners = refreshed.winners ?? [];
              if (!winners[waveIdx - 1]) {
                // Persist winner username (legacy array) and detailed wave clear info
                const nowMs = Date.now();
                const me = await User.getCurrent();
                await Challenge.appendWinner({ challengeNumber, wave: waveIdx, username });
                await Challenge.appendWaveClear({
                  challengeNumber,
                  wave: waveIdx,
                  username,
                  ...(me.snoovatar ? { snoovatar: me.snoovatar } : {}),
                  word: target,
                  clearedAtMs: nowMs,
                });

                await Challenge.setCurrentHordeLevel({ challengeNumber, level: waveIdx + 1 });
                const newTimeRemaining = await Challenge.incrementTimeRemaining({
                  challengeNumber,
                  deltaMs: 2 * 60 * 1000,
                });

                // If this was the final wave, mark the challenge as won and freeze the timer
                const totalWaves = Array.isArray(refreshed.words) ? refreshed.words.length : 0;
                if (waveIdx >= totalWaves) {
                  try {
                    await Challenge.setStatus({ challengeNumber, status: 'won' });
                  } catch (e) {
                    console.error('Failed to persist won status for horde', e);
                  }
                }

                const channel = hordeChannelName(challengeNumber);
                const totalWavesMsg = Array.isArray(challengeInfo.words)
                  ? challengeInfo.words.length
                  : 0;
                const payload: HordeMessage = {
                  type: 'wave_cleared',
                  challengeNumber,
                  wave: waveIdx,
                  winner: username,
                  ...(me.snoovatar ? { winnerSnoovatar: me.snoovatar } : {}),
                  word: target,
                  clearedAtMs: nowMs,
                  nextWave: waveIdx + 1,
                  timeRemainingMs: newTimeRemaining,
                  totalWaves: totalWavesMsg,
                };
                try {
                  await realtime.send(channel, payload);
                } catch (e) {
                  console.error('Failed to emit wave_cleared', e);
                }

                // Refresh cached challenge info for subsequent guesses
                challengeInfo = refreshed;
              }
            }
          }
        }

        // Refresh in-memory state for the next iteration
        challengeUserInfo = await getChallengeUserInfo({ username, challengeNumber });
      }

      return {
        challengeNumber,
        challengeInfo,
        challengeUserInfo,
      } as z.infer<typeof GameResponseSchema>;
    }
  );
}
