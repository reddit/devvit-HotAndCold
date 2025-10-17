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
      guesses: z.array(
        z.object({
          word: z.string().trim().toLowerCase(),
          similarity: z.number(),
          rank: z.number(),
          isHint: z.boolean().optional(),
        })
      ),
    }),
    async ({ username, challengeNumber, guesses: rawGuesses }) => {
      if (rawGuesses.length === 0) throw new Error('Must provide at least one guess');

      await maybeInitForUser({ username, challengeNumber });

      let challengeUserInfo = await getChallengeUserInfo({ username, challengeNumber });
      const challengeInfo = await Challenge.getChallenge({ challengeNumber });

      for (const raw of rawGuesses) {
        const { word, similarity, rank } = raw;

        // First-ever guess bookkeeping
        if (!challengeUserInfo.startedPlayingAtMs) {
          const started = Date.now();
          const userInfo = await User.getCurrent();
          await Challenge.incrementChallengeTotalPlayers({ challengeNumber });
          await redis.hSet(Key(challengeNumber, username), {
            startedPlayingAtMs: started.toString(),
          });
          // No progress service in HORDE
          void userInfo; // avoid unused warning
        }

        // Prevent duplicates for this user
        if (challengeUserInfo.guesses?.some((g) => g.word === word)) {
          throw new Error(`You already guessed ${word}.`);
        }

        await Challenge.incrementChallengeTotalGuesses({ challengeNumber });
        // Track per-user guess count for leaderboard
        await HordeGuess.incrementGuesserCount({ challengeNumber, username });

        const guessToAdd: z.infer<typeof GuessSchema> = {
          word,
          timestampMs: Date.now(),
          similarity,
          rank: Number.isFinite(rank) ? rank : -1,
          isHint: raw.isHint === true,
        };

        const newGuesses = z
          .array(GuessSchema)
          .parse([...(challengeUserInfo.guesses ?? []), guessToAdd]);
        await redis.hSet(Key(challengeNumber, username), { guesses: JSON.stringify(newGuesses) });

        // Update global HORDE aggregates
        await HordeGuess.add({ challengeNumber, word, username, rank, similarity });

        // If this was the secret for the current wave, record winner and emit wave_cleared
        if (similarity === 1) {
          // Only accept win if the guess matches the current wave's word
          const currentLevel = Number(challengeInfo.currentHordeLevel ?? 1);
          const target = challengeInfo.words?.[currentLevel - 1];
          if (target && target.toLowerCase() === word.toLowerCase()) {
            // Atomic-ish: re-read level and set winner for that wave index only if unset
            const refreshed = await Challenge.getChallenge({ challengeNumber });
            const liveLevel = Number(refreshed.currentHordeLevel ?? currentLevel);
            const waveIdx = Math.max(1, liveLevel);
            const winners = (refreshed as any).winners ?? [];
            if (!winners[waveIdx - 1]) {
              await Challenge.appendWinner({ challengeNumber, wave: waveIdx, username });
              await Challenge.setCurrentHordeLevel({ challengeNumber, level: waveIdx + 1 });
              const newTimeRemaining = await Challenge.incrementTimeRemaining({
                challengeNumber,
                deltaMs: 2 * 60 * 1000,
              });

              const channel = hordeChannelName(challengeNumber);
              const payload: HordeMessage = {
                type: 'wave_cleared',
                challengeNumber,
                wave: waveIdx,
                winner: username,
                nextWave: waveIdx + 1,
                timeRemainingMs: newTimeRemaining,
              };
              try {
                await realtime.send(channel, payload);
              } catch (e) {
                console.error('Failed to emit wave_cleared', e);
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
