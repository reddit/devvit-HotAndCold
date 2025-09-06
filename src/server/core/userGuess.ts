import { z } from 'zod';
import { isEmptyObject } from '../../shared/isEmptyObject';
import { zodRedditUsername } from '../utils';
import { Challenge } from './challenge';
import { ChallengeLeaderboard } from './challengeLeaderboard';
import { Score } from './score';
import { fn } from '../../shared/fn';
import { redis } from '@devvit/web/server';
import { GameResponseSchema, GuessSchema, ChallengeUserInfoSchema } from '../utils';
import { User } from './user';
import { ChallengeProgress } from './challengeProgress';
import { rankToProgress } from '../../shared/progress';

/**
 * Returns the next hint for a player based on their previous guesses.
 */
export function _selectNextHint(params: {
  similarWords: z.infer<typeof GuessSchema>[];
  previousGuesses: z.infer<typeof GuessSchema>[];
}): z.infer<typeof GuessSchema> | null {
  const { similarWords, previousGuesses } = params;
  const words = similarWords.slice(0, 250);
  const guessedWords = new Set(previousGuesses.map((g) => g.word));

  // Helper to find next unguessed hint
  const findNextHint = (startIndex: number, endIndex: number, searchForward: boolean) => {
    const indices = searchForward
      ? Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i)
      : Array.from({ length: startIndex + 1 }, (_, i) => startIndex - i);

    for (const i of indices) {
      if (words[i]?.isHint && !guessedWords.has(words[i].word)) {
        return words[i];
      }
    }
    return null;
  };

  // First hint with no guesses - return the furthest unguessed hint
  if (previousGuesses.length === 0) {
    return findNextHint(words.length - 1, 0, false);
  }

  // Find index of their most similar valid guess
  const validGuesses = previousGuesses.filter((g) => g.rank >= 0);
  if (validGuesses.length === 0) {
    return findNextHint(words.length - 1, 0, false);
  }

  const closestIndex = Math.min(...validGuesses.map((g) => g.rank));

  // If they've guessed the most similar word, look for next unguessed hint
  if (closestIndex === 0) {
    return findNextHint(1, words.length - 1, true);
  }

  // Target halfway between their best guess and the target word
  const targetIndex = Math.floor(closestIndex / 2);

  // Try to find hint:
  // 1. Search forward from target
  const forwardHint = findNextHint(targetIndex, closestIndex, true);
  if (forwardHint) return forwardHint;

  // 2. Search backward from target
  const backwardHint = findNextHint(targetIndex - 1, 0, false);
  if (backwardHint) return backwardHint;

  // 3. Search forward from their closest guess as last resort
  const lastResortHint = findNextHint(closestIndex + 1, words.length - 1, true);
  return lastResortHint;
}

export namespace UserGuess {
  /**
   * Key helper for Redis user → challenge data.
   */
  export const Key = (challengeNumber: number, username: string) =>
    `${Challenge.ChallengeKey(challengeNumber)}:user:${username}` as const;

  /**
   * Read the user‑specific state for a challenge.
   */
  export const getChallengeUserInfo = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      // Primary lookup (sanitized username)
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
        let scoreParsed: unknown | undefined = undefined;
        if (raw.score) {
          try {
            scoreParsed = JSON.parse(raw.score);
          } catch {
            scoreParsed = undefined;
          }
        }
        return ChallengeUserInfoSchema.parse({
          username,
          startedPlayingAtMs,
          gaveUpAtMs,
          solvedAtMs,
          guesses: guessesParsed,
          ...(scoreParsed ? { score: scoreParsed } : {}),
        });
      };

      if (result && !isEmptyObject(result)) {
        return parseFrom(result);
      }

      // No state yet for this user/challenge – return an empty/default shape.
      return ChallengeUserInfoSchema.parse({ username, guesses: [] });
    }
  );

  /**
   * Initialise empty user state if it doesn't exist yet.
   */
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

  /**
   * Mark the challenge as solved for the player.
   */
  const markChallengeSolvedForUser = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
      completedAt: z.number(),
      score: Score.Info,
    }),
    async ({ username, challengeNumber, completedAt, score }) => {
      await redis.hSet(Key(challengeNumber, username), {
        solvedAtMs: completedAt.toString(),
        score: JSON.stringify(score),
      });
    }
  );

  /**
   * Update the "startedPlayingAtMs" marker for first‑time players.
   */
  const markChallengePlayedForUser = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      await redis.hSet(Key(challengeNumber, username), {
        startedPlayingAtMs: Date.now().toString(),
      });
    }
  );

  /**
   * Mark the challenge as given up for the player.
   */
  export const giveUp = fn(
    z.object({
      username: zodRedditUsername,
      challengeNumber: z.number().gt(0),
    }),
    async ({ username, challengeNumber }) => {
      await maybeInitForUser({ username, challengeNumber });

      const [challengeInfo, currentUserInfo] = await Promise.all([
        Challenge.getChallenge({ challengeNumber }),
        getChallengeUserInfo({ username, challengeNumber }),
      ]);

      // If they have never started, mark started + increment players
      if (!currentUserInfo.startedPlayingAtMs) {
        await markChallengePlayedForUser({ username, challengeNumber });
        await Challenge.incrementChallengeTotalPlayers({ challengeNumber });
      }

      const now = Date.now();
      const secretWord = challengeInfo.secretWord;

      // Append a reveal guess with the secret word so clients can display it
      const guessToAdd: z.infer<typeof GuessSchema> = {
        word: secretWord,
        timestampMs: now,
        similarity: 1,
        rank: 0,
        isHint: true,
      };

      const newGuesses = z
        .array(GuessSchema)
        .parse([...(currentUserInfo.guesses ?? []), guessToAdd]);

      await redis.hSet(Key(challengeNumber, username), {
        gaveUpAtMs: now.toString(),
        guesses: JSON.stringify(newGuesses),
      });

      await Challenge.incrementChallengeTotalGiveUps({ challengeNumber });

      const updated = await getChallengeUserInfo({ username, challengeNumber });

      return {
        challengeNumber,
        challengeUserInfo: updated,
        challengeInfo: {
          ...challengeInfo,
          totalGiveUps: (challengeInfo.totalGiveUps ?? 0) + 1,
          totalPlayers: currentUserInfo.startedPlayingAtMs
            ? challengeInfo.totalPlayers
            : (challengeInfo.totalPlayers ?? 0) + 1,
        },
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
        })
      ),
    }),
    async ({
      username,
      challengeNumber,
      guesses: rawGuesses,
    }): Promise<z.infer<typeof GameResponseSchema>> => {
      if (rawGuesses.length === 0) {
        throw new Error('Must provide at least one guess');
      }

      await maybeInitForUser({ username, challengeNumber });

      let challengeUserInfo = await getChallengeUserInfo({
        username,
        challengeNumber,
      });

      const challengeInfo = await Challenge.getChallenge({ challengeNumber });
      if (!challengeInfo) throw new Error(`Challenge ${challengeNumber} not found`);

      // Iterate through each guess sequentially. As soon as the user solves the
      // challenge we short‑circuit and return.
      for (const rawGuess of rawGuesses) {
        const result = await _processSingleGuess({
          username,
          challengeNumber,
          rawGuess: rawGuess.word,
          similarity: rawGuess.similarity,
          rank: rawGuess.rank,
          challengeInfo,
          challengeUserInfo,
        });

        // Refresh in‑memory state for potential next iteration
        challengeUserInfo = await getChallengeUserInfo({
          username,
          challengeNumber,
        });

        if (result.challengeUserInfo.solvedAtMs != null) {
          // Already solved – no need to process further guesses in this batch.
          return result;
        }
      }

      // Return the game state after processing the *entire* batch where the
      // player did **not** solve the challenge.
      return {
        challengeNumber,
        challengeInfo,
        challengeUserInfo,
      };
    }
  );

  /**
   * Internal helper to process a single guess. Extracted to keep `submitGuess`
   * readable even after batching support.
   */
  const _processSingleGuess = async (params: {
    username: string;
    challengeNumber: number;
    rawGuess: string;
    similarity: number;
    rank: number;
    challengeInfo: Awaited<ReturnType<typeof Challenge.getChallenge>>;
    challengeUserInfo: Awaited<ReturnType<typeof getChallengeUserInfo>>;
  }): Promise<z.infer<typeof GameResponseSchema>> => {
    const {
      username,
      challengeNumber,
      rawGuess,
      similarity,
      rank,
      challengeInfo,
      challengeUserInfo,
    } = params;

    const secretWord = challengeInfo.secretWord;

    let startedPlayingAtMs = challengeUserInfo.startedPlayingAtMs;
    let isFirstGuessInLifeCycle = false;

    if (!startedPlayingAtMs) {
      // First‑ever guess for this challenge → mark player & totals.
      isFirstGuessInLifeCycle = true;
      startedPlayingAtMs = Date.now();
      // add to redis cache if not exists
      const userInfo = await User.getCurrent();
      await Challenge.incrementChallengeTotalPlayers({ challengeNumber });
      await markChallengePlayedForUser({ username, challengeNumber });
      await ChallengeProgress.markPlayerStarted({
        challengeNumber,
        username,
        startedAtMs: startedPlayingAtMs,
        avatar: userInfo.snoovatar,
      });
    }

    // Prevent duplicate guesses.
    const alreadyGuessed = challengeUserInfo.guesses?.find((g) => g.word === rawGuess);
    if (alreadyGuessed) {
      throw new Error(`You already guessed ${rawGuess} (#${alreadyGuessed.rank}).`);
    }

    await Challenge.incrementChallengeTotalGuesses({ challengeNumber });

    // TODO: Think about how to do this
    // const indexOfGuess = wordConfig.similar_words.findIndex((x) => x.word === distance.wordBLemma);
    // const rankOfWord = indexOfGuess === -1 ? -1 : indexOfGuess + 1; // +1 because target is omitted.

    const guessToAdd: z.infer<typeof GuessSchema> = {
      word: rawGuess,
      timestampMs: Date.now(),
      similarity,
      rank: Number.isFinite(rank) ? rank : -1,
      isHint: false,
    };

    const newGuesses = z
      .array(GuessSchema)
      .parse([...(challengeUserInfo.guesses ?? []), guessToAdd]);

    await redis.hSet(Key(challengeNumber, username), {
      guesses: JSON.stringify(newGuesses),
    });

    // Update progress as the best rank so far across non-hint guesses
    const bestRank = newGuesses
      .filter((g) => !g.isHint && Number.isFinite(g.rank) && g.rank >= 0)
      .reduce<number>(
        (minRank, g) => (g.rank < minRank ? g.rank : minRank),
        Number.POSITIVE_INFINITY
      );
    const progress = Number.isFinite(bestRank) ? Math.round(rankToProgress(bestRank)) : 0;
    await ChallengeProgress.upsertProgress({
      challengeNumber,
      username,
      progress,
    });

    const hasSolved = rawGuess === secretWord;
    let score: z.infer<typeof Score.Info> | undefined;

    if (hasSolved) {
      // Player has solved the challenge: calculate score & update leaderboard.
      if (!startedPlayingAtMs) throw new Error('Unexpected state: startedPlayingAtMs missing');

      const completedAt = Date.now();
      const solveTimeMs = completedAt - startedPlayingAtMs;
      score = Score.calculateScore({
        solveTimeMs,
        totalGuesses: newGuesses.length,
        totalHints: newGuesses.filter((g: z.infer<typeof GuessSchema>) => g.isHint).length,
      });

      await markChallengeSolvedForUser({
        username,
        challengeNumber,
        completedAt,
        score,
      });

      await Challenge.incrementChallengeTotalSolves({ challengeNumber });

      await ChallengeLeaderboard.addEntry({
        challengeNumber,
        username,
        score: score.finalScore,
        timeToCompleteMs: solveTimeMs,
      });
    }

    // await ChallengeProgress.upsertEntry({
    //   challengeNumber,
    //   username,
    //   progress: Math.max(
    //     guessToAdd.normalizedSimilarity,
    //     ...(challengeUserInfo.guesses
    //       ?.filter((g) => !g.isHint)
    //       .map((g) => g.normalizedSimilarity) ?? [])
    //   ),
    // });

    const gameState: z.infer<typeof GameResponseSchema> = {
      challengeNumber,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
        ...(hasSolved && { solvedAtMs: Date.now(), score }),
      },
      challengeInfo: {
        ...challengeInfo,
        totalGuesses: (challengeInfo.totalGuesses ?? 0) + 1,
        totalPlayers: isFirstGuessInLifeCycle
          ? (challengeInfo.totalPlayers ?? 0) + 1
          : challengeInfo.totalPlayers,
        totalSolves: hasSolved ? (challengeInfo.totalSolves ?? 0) + 1 : challengeInfo.totalSolves,
      },
      // challengeProgress: await ChallengeProgress.getPlayerProgress({
      //   context,
      //   challengeNumber,
      //   sort: 'DESC',
      //   start: 0,
      //   stop: 20,
      //   username,
      // }),
    };

    return gameState;
  };
}
