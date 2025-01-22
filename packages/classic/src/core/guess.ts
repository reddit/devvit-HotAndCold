import { z } from 'zod';
import { getPrettyDuration, getHeatForGuess, isEmptyObject, omit } from '@hotandcold/shared/utils';
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from '@hotandcold/shared/utils/zoddy';
import { Challenge } from './challenge.js';
import { API } from './api.js';
import { Streaks } from './streaks.js';
import { ChallengeLeaderboard } from './challengeLeaderboard.js';
import { Score } from './score.js';
import { GameResponse, Guess } from '@hotandcold/classic-shared';
import { Similarity } from './similarity.js';
import { ChallengePlayers } from './challengePlayers.js';
import { ChallengeProgress } from './challengeProgress.js';
import { Comment, RichTextBuilder } from '@devvit/public-api';
import { Feedback } from './feedback.js';
import { ChallengeToPost } from './challengeToPost.js';
import { sendMessageToWebview } from '../utils/index.js';
import { guessSchema } from '../utils/guessSchema.js';

export * as Guess from './guess.js';

export const getChallengeUserKey = (challengeNumber: number, username: string) =>
  `${Challenge.getChallengeKey(challengeNumber)}:user:${username}` as const;

const challengeUserInfoSchema = z
  .object({
    username: z.string(),
    score: z
      .string()
      .transform((val) => {
        if (val === undefined) return undefined;
        if (val === '') return undefined;

        const parsed = JSON.parse(val);

        return Score.scoreSchema.parse(parsed);
      })
      .optional(),
    winnersCircleCommentId: z.string().optional(),
    startedPlayingAtMs: redisNumberString.optional(),
    solvedAtMs: redisNumberString.optional(),
    gaveUpAtMs: redisNumberString.optional(),
    guesses: z
      .string()
      .transform((val) => {
        const maybeArray = JSON.parse(val);

        if (!Array.isArray(maybeArray)) {
          return [];
        }

        return maybeArray.map((x) => guessSchema.parse(x));
      })
      .optional(),
  })
  .strict();

export const getChallengeUserInfo = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(getChallengeUserKey(challenge, username));

    if (!result) {
      throw new Error(`No user found for ${username} on day ${challenge}`);
    }

    return challengeUserInfoSchema.parse({
      username,
      ...result,
    });
  }
);

const maybeInitForUser = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(getChallengeUserKey(challenge, username));

    if (!result || isEmptyObject(result)) {
      await redis.hSet(getChallengeUserKey(challenge, username), {
        username,
        guesses: '[]',
      });
    }
  }
);

export const markChallengeSolvedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    completedAt: z.number(),
    score: Score.scoreSchema,
    winnersCircleCommentId: z.string().optional(),
  }),
  async ({ redis, username, challenge, completedAt, score, winnersCircleCommentId }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      solvedAtMs: completedAt.toString(),
      score: JSON.stringify(score),
      winnersCircleCommentId: winnersCircleCommentId ?? '',
    });
  }
);

export const markChallengePlayedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      startedPlayingAtMs: Date.now().toString(),
    });
  }
);

export type Word = {
  word: string;
  similarity: number;
  is_hint: boolean;
  definition: string;
};

export function _selectNextHint(params: {
  similarWords: Word[];
  previousGuesses: Guess[];
}): Word | null {
  const { similarWords, previousGuesses } = params;
  const words = similarWords.slice(0, 250);
  const guessedWords = new Set(previousGuesses.map((g) => g.word));

  // Helper to find next unguessed hint
  const findNextHint = (startIndex: number, endIndex: number, searchForward: boolean) => {
    const indices = searchForward
      ? Array.from({ length: endIndex - startIndex + 1 }, (_, i) => startIndex + i)
      : Array.from({ length: startIndex + 1 }, (_, i) => startIndex - i);

    for (const i of indices) {
      if (words[i]?.is_hint && !guessedWords.has(words[i].word)) {
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

export const getHintForUser = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ context, username, challenge }): Promise<GameResponse> => {
    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });
    const wordConfig = await API.getWordConfigCached({
      context,
      word: challengeInfo.word,
    });
    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    const newHint = _selectNextHint({
      previousGuesses: challengeUserInfo.guesses ?? [],
      similarWords: wordConfig.similar_words,
    });

    if (!newHint) {
      throw new Error(`I don't have anymore hints!`);
    }

    const hintToAdd: z.infer<typeof guessSchema> = {
      word: newHint.word,
      timestamp: Date.now(),
      similarity: newHint.similarity,
      normalizedSimilarity: Similarity.normalizeSimilarity({
        closestWordSimilarity: wordConfig.closest_similarity,
        furthestWordSimilarity: wordConfig.furthest_similarity,
        targetWordSimilarity: newHint.similarity,
      }),
      rank: wordConfig.similar_words.findIndex((x) => x.word === newHint.word),
      isHint: true,
    };

    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    await Challenge.incrementChallengeTotalHints({ redis: txn, challenge });

    const newGuesses = z
      .array(guessSchema)
      .parse([...(challengeUserInfo.guesses ?? []), hintToAdd]);

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    // Do not progress when hints are used!
    // await ChallengeProgress.upsertEntry({
    //   redis: txn,
    //   challenge,
    //   username,
    //   progress: Math.max(
    //     hintToAdd.normalizedSimilarity,
    //     ...challengeUserInfo.guesses?.map((x) => x.normalizedSimilarity) ?? [],
    //   ),
    // });

    // await txn.exec();

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      context,
      sort: 'DESC',
      start: 0,
      stop: 1000,
      username,
    });

    // Clears out any feedback (like the feedback that prompted them to take a hint!)
    sendMessageToWebview(context, {
      type: 'FEEDBACK',
      payload: {
        feedback: '',
      },
    });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: [...(challengeUserInfo.guesses ?? []), hintToAdd],
      },
      challengeInfo: {
        ...omit(challengeInfo, ['word']),
        totalHints: (challengeInfo.totalHints ?? 0) + 1,
      },
      challengeProgress,
    };
  }
);

export const submitGuess = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    avatar: z.string().nullable(),
    challenge: z.number().gt(0),
    guess: z.string().trim().toLowerCase(),
  }),
  async ({ context, username, challenge, guess: rawGuess, avatar }): Promise<GameResponse> => {
    await maybeInitForUser({ redis: context.redis, username, challenge });

    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    // Empty string check since we initially set it! Added other falsies just in case
    let startedPlayingAtMs = challengeUserInfo.startedPlayingAtMs;
    let isFirstGuess = false;
    if (!challengeUserInfo.startedPlayingAtMs) {
      isFirstGuess = true;
      startedPlayingAtMs = Date.now();
      await ChallengePlayers.setPlayer({
        redis: txn,
        username,
        avatar,
        challenge,
      });
      await Challenge.incrementChallengeTotalPlayers({ redis: txn, challenge });
      await markChallengePlayedForUser({ challenge, redis: txn, username });
    }

    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }

    const distance = await API.compareWordsCached({
      context,
      secretWord: challengeInfo.word,
      guessWord: rawGuess,
    });

    console.log(`Username: ${username}:`, 'distance', distance);

    const alreadyGuessWord =
      challengeUserInfo.guesses &&
      challengeUserInfo.guesses.length > 0 &&
      challengeUserInfo.guesses.find((x) => x.word === distance.wordBLemma);
    if (alreadyGuessWord) {
      if (rawGuess !== distance.wordBLemma) {
        throw new Error(
          `We changed your guess to ${distance.wordBLemma} (${alreadyGuessWord.normalizedSimilarity}%) and you've already tried that.`
        );
      }
      throw new Error(
        `You've already guessed ${distance.wordBLemma} (${alreadyGuessWord.normalizedSimilarity}%).`
      );
    }

    if (distance.similarity == null) {
      // Somehow there's a bug where "word" didn't get imported and appears to be the
      // only word. Leaving this in as an easter egg and fixing the bug like this :D
      if (distance.wordBLemma === 'word') {
        throw new Error(`C'mon, you can do better than that!`);
      }

      throw new Error(`Sorry, I'm not familiar with that word.`);
    }

    const wordConfig = await API.getWordConfigCached({
      context,
      word: challengeInfo.word,
    });

    await Challenge.incrementChallengeTotalGuesses({ redis: txn, challenge });

    console.log(`Username: ${username}:`, 'increment total guess complete');

    let rankOfWord: number | undefined = undefined;
    const indexOfGuess = wordConfig.similar_words.findIndex((x) => x.word === distance.wordBLemma);
    if (indexOfGuess === -1) {
      // The word was found!
      if (distance.similarity === 1) {
        rankOfWord = 0;
      }

      // If the word is in the most similar words, rank it -1 meaning
      // it's not close!
      rankOfWord = -1;
    } else {
      // Plus one because similar words does not have the target word
      // So the closest you can ever guess is the 1st closest word
      rankOfWord = indexOfGuess + 1;
    }

    const guessToAdd: z.infer<typeof guessSchema> = {
      word: distance.wordBLemma,
      timestamp: Date.now(),
      similarity: distance.similarity,
      normalizedSimilarity: Similarity.normalizeSimilarity({
        closestWordSimilarity: wordConfig.closest_similarity,
        furthestWordSimilarity: wordConfig.furthest_similarity,
        targetWordSimilarity: distance.similarity,
      }),
      rank: rankOfWord,
      isHint: false,
    };

    const newGuesses = z
      .array(guessSchema)
      .parse([
        ...(challengeUserInfo.guesses ?? []),
        guessToAdd,
        // This works around a bug where I would accidentally add the secret word to the guesses
        // but score it on the guessed word's similarity. This shim will remove the secret word
        // to let the game self heal.
      ])
      .filter((x) => !(x.word === distance.wordA && x.similarity !== 1));

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    const hasSolved = distance.similarity === 1;
    let score: Score.ScoreExplanation | undefined = undefined;
    if (hasSolved) {
      console.log(`User ${username} solved challenge ${challenge}!`);
      if (!startedPlayingAtMs) {
        throw new Error(`User ${username} has not started playing yet but solved?`);
      }
      const completedAt = Date.now();
      const solveTimeMs = completedAt - startedPlayingAtMs;
      console.log('Calculating score...');
      score = Score.calculateScore({
        solveTimeMs,
        // Need to manually add guess here since this runs in a transaction
        // and the guess has not been added to the user's guesses yet
        totalGuesses: newGuesses.length,
        totalHints: challengeUserInfo.guesses?.filter((x) => x.isHint)?.length ?? 0,
      });

      console.log(`Score for user ${username} is ${JSON.stringify(score)}`);

      console.log(`Marking challenge as solved for user ${username}`);

      const currentChallengeNumber = await Challenge.getCurrentChallengeNumber({
        redis: txn,
      });

      // NOTE: This is bad for perf and should really be a background job or something
      // Users might see a delay in seeing the winning screen
      let winnersCircleComment: Comment | undefined;
      if (challengeInfo.winnersCircleCommentId) {
        const rootCommentThread = await context.reddit.getCommentById(
          challengeInfo.winnersCircleCommentId
        );

        const coldestGuess = newGuesses.reduce((prev, current) =>
          prev.normalizedSimilarity < current.normalizedSimilarity ? prev : current
        );
        const averageNormalizedSimilarity = Math.round(
          newGuesses.reduce((acc, current) => acc + current.normalizedSimilarity, 0) /
            newGuesses.length
        );
        const totalHints = newGuesses.filter((x) => x.isHint).length;

        winnersCircleComment = await rootCommentThread.reply({
          // @ts-expect-error The types in devvit are wrong
          richtext: new RichTextBuilder()
            .paragraph((p) => p.text({ text: `u/${username} solved the challenge!` }))
            .paragraph((p) =>
              p.text({
                text: newGuesses
                  .map((item) => {
                    const heat = getHeatForGuess(item);
                    if (heat === 'COLD') {
                      return '🔵';
                    }

                    if (heat === 'WARM') {
                      return '🟡';
                    }

                    if (heat === 'HOT') {
                      return '🔴';
                    }
                  })
                  .join(''),
              })
            )
            .paragraph((p) => {
              p.text({
                text: `Score: ${score?.finalScore}${score?.finalScore === 100 ? ' (perfect)' : ''}`,
              });
              p.linebreak();
              p.text({
                text: `Total guesses: ${newGuesses.length} (${totalHints} hints)`,
              });
              p.linebreak();
              p.text({
                text: `Time to solve: ${getPrettyDuration(
                  new Date(startedPlayingAtMs),
                  new Date(completedAt)
                )}`,
              });
              p.linebreak();
              p.text({
                text: `Coldest guess: ${coldestGuess.word} (${coldestGuess.normalizedSimilarity}%)`,
              });
              p.linebreak();
              p.text({
                text: `Average heat: ${averageNormalizedSimilarity}%`,
              });
            })
            .build(),
        });
      }

      await markChallengeSolvedForUser({
        challenge,
        redis: txn,
        username,
        completedAt,
        score,
        winnersCircleCommentId: winnersCircleComment?.id,
      });

      console.log(`Incrementing streak for user ${username}`);

      // Only increment streak if the user solved the current day's challenge
      if (currentChallengeNumber === challenge) {
        console.log(`User ${username} solved today's challenge, incrementing streak`);
        await Streaks.incrementEntry({ redis: txn, username });
      } else {
        console.log(`User ${username} solved a past challenge, skipping streak increment`);
      }

      console.log(`Incrementing total solves for challenge ${challenge}`);

      await Challenge.incrementChallengeTotalSolves({ redis: txn, challenge });

      console.log(`Adding entry to leaderboard for user ${username}`);

      await ChallengeLeaderboard.addEntry({
        redis: txn,
        challenge,
        username,
        score: score.finalScore,
        timeToCompleteMs: solveTimeMs,
      });

      console.log(`End of winning logic for user ${username}`);
    }

    await ChallengeProgress.upsertEntry({
      redis: txn,
      challenge,
      username,
      progress: Math.max(
        guessToAdd.normalizedSimilarity,
        ...(challengeUserInfo.guesses
          ?.filter((x) => x.isHint === false)
          .map((x) => x.normalizedSimilarity) ?? [])
      ),
    });

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      context,
      sort: 'DESC',
      start: 0,
      stop: 1000,
      username,
    });

    // TODO: Nice place for messages like asking for upvotes and progressive onboarding
    /**
     * It's safe to assume there's no high priority messages by the time you make it here because
     * we would have thrown them above.
     */
    // Feedback.sendMessage({
    //   context,
    //   newGuesses,
    // });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
        solvedAtMs: hasSolved ? Date.now() : undefined,
        score,
      },
      challengeInfo: {
        ...omit(challengeInfo, ['word']),
        totalGuesses: (challengeInfo.totalGuesses ?? 0) + 1,
        // Only optimistically increment on their first guess
        totalPlayers: isFirstGuess
          ? (challengeInfo.totalPlayers ?? 0) + 1
          : challengeInfo.totalPlayers,
        totalSolves: hasSolved ? (challengeInfo.totalSolves ?? 0) + 1 : 0,
      },
      challengeProgress,
    };
  }
);

export const giveUp = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ context, username, challenge }): Promise<GameResponse> => {
    // TODO: Transactions are broken
    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    if (challengeUserInfo.startedPlayingAtMs == null) {
      throw new Error(`User ${username} has not started playing yet`);
    }

    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }

    await txn.hSet(getChallengeUserKey(challenge, username), {
      gaveUpAtMs: Date.now().toString(),
    });

    const guessToAdd: z.infer<typeof guessSchema> = {
      word: challengeInfo.word,
      timestamp: Date.now(),
      similarity: 1,
      normalizedSimilarity: 100,
      rank: 0,
      isHint: true,
    };

    const newGuesses = z
      .array(guessSchema)
      .parse([...(challengeUserInfo.guesses ?? []), guessToAdd]);

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    await Challenge.incrementChallengeTotalGiveUps({ redis: txn, challenge });

    await ChallengeProgress.upsertEntry({
      redis: txn,
      challenge,
      username,
      // Giving up doesn't count!
      progress: -1,
    });

    // await txn.exec();

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      context,
      sort: 'DESC',
      start: 0,
      stop: 1000,
      username,
    });

    // Clears out any feedback (like the feedback that prompted them to take a hint!)
    sendMessageToWebview(context, {
      type: 'FEEDBACK',
      payload: {
        feedback: '',
      },
    });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        gaveUpAtMs: Date.now(),
        guesses: newGuesses,
      },
      challengeInfo: {
        ...omit(challengeInfo, ['word']),
        totalGiveUps: (challengeInfo.totalGiveUps ?? 0) + 1,
      },
      challengeProgress,
    };
  }
);
