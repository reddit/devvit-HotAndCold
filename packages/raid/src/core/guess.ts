import { z } from 'zod';
import {
  guessSchema,
  redisNumberString,
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from '../utils/zoddy.js';
import { Challenge } from './challenge.js';
import { API } from './api.js';
import { isEmptyObject, omit, sendMessageToWebview } from '../utils/utils.js';
import { Similarity } from './similarity.js';
import { ChallengePlayers } from './challengePlayers.js';
import { GameResponse } from '@hotandcold/raid-shared';

export * as Guess from './guess.js';

export const getChallengeUserKey = (challengeNumber: number, username: string) =>
  `${Challenge.getChallengeKey(challengeNumber)}:user:${username}` as const;

const challengeUserInfoSchema = z
  .object({
    username: z.string(),
    startedPlayingAtMs: redisNumberString.optional(),
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
    if (hasSolved) {
      console.log(`SOMEONE SOLVED IT!!!`);

      //  TODO:

      console.log(`End of winning logic for user ${username}`);
    }

    // TODO: Nice place for messages like asking for upvotes and progressive onboarding

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
      },
      challengeInfo: {
        ...omit(challengeInfo, ['word']),
        totalGuesses: (challengeInfo.totalGuesses ?? 0) + 1,
        // Only optimistically increment on their first guess
        totalPlayers: isFirstGuess
          ? (challengeInfo.totalPlayers ?? 0) + 1
          : challengeInfo.totalPlayers,
      },
    };
  }
);
