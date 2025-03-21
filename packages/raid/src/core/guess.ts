import { z } from 'zod';
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from '@hotandcold/shared/utils/zoddy';
import { Challenge, challengeSchema } from './challenge.js';
import { API } from './api.js';
import { isEmptyObject, omit } from '@hotandcold/shared/utils';
import { Similarity } from './similarity.js';
import { ChallengePlayers } from './challengePlayers.js';
import { GameResponse } from '@hotandcold/raid-shared';
import { guessSchema } from '../utils/guessSchema.js';
import { ChallengeToStatus } from './challengeToStatus.js';
import { ChallengeGuesses } from './challengeGuesses.js';
import { ChallengeFaucet } from './challengeFaucet.js';

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

    const challengeStatus = await ChallengeToStatus.getStatusForChallengeNumber({
      redis: txn,
      challenge,
    });

    if (challengeStatus !== 'ACTIVE') {
      throw new Error(`Sorry, this challenge is no longer active.`);
    }

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    const availableTokensBeforeGuess = await ChallengeFaucet.getAvailableTokensForPlayer({
      challenge,
      redis: txn,
      username,
    });

    console.log('availableTokensBeforeGuess', availableTokensBeforeGuess);

    if (availableTokensBeforeGuess <= 0) {
      throw new Error(
        `You're out of guesses. You get a new one every minute. In the meantime, join in on the conversation below!`
      );
    }

    let isFirstGuess = false;
    if (!challengeUserInfo.startedPlayingAtMs) {
      isFirstGuess = true;
      await ChallengePlayers.setPlayer({
        redis: txn,
        username,
        avatar,
        challenge,
      });
      await ChallengeFaucet.addPlayerFaucet({
        challenge,
        redis: txn,
        username,
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
      onCacheMiss: async () => {
        // This is how we compute the % words of english dictionary!
        Challenge.incrementChallengeTotalUniqueGuesses({ redis: txn, challenge });
      },
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
      username,
      snoovatar: avatar ?? undefined,
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

    await ChallengeGuesses.addGuess({
      challenge,
      guess: guessToAdd,
      redis: txn,
      username,
    });
    await ChallengeFaucet.consumeTokenForPlayer({
      challenge,
      redis: txn,
      username,
    });

    console.log(`Challenge ${challenge} guess added`);

    const hasSolved = distance.similarity === 1;

    const newChallengeInfo = {
      ...omit(challengeInfo, ['word']),
      totalGuesses: (challengeInfo.totalGuesses ?? 0) + 1,
      // Only optimistically increment on their first guess
      totalPlayers: isFirstGuess
        ? (challengeInfo.totalPlayers ?? 0) + 1
        : challengeInfo.totalPlayers,
    };

    if (hasSolved) {
      await Promise.all([
        Challenge.markChallengeSolved({
          redis: txn,
          challenge,
          solvedAtMs: Date.now().toString(),
          solvingUser: username,
          solvingUserSnoovatar: avatar ?? undefined,
        }),
        ChallengeToStatus.setStatusForChallenge({
          redis: txn,
          challenge,
          status: 'COMPLETED',
        }),
      ]);

      newChallengeInfo.solvedAtMs = Date.now();
      newChallengeInfo.solvingUser = username;
      newChallengeInfo.solvingUserSnoovatar = avatar ?? undefined;
      // Only add on solved!
      // @ts-expect-error - Too lazy to fix
      newChallengeInfo.word = challengeInfo.word;

      // @ts-ignore I'm sure it's fine
      await context.realtime.send('RAID_SOLVED', { challengeInfo: newChallengeInfo });

      console.log(`End of winning logic for user ${username}`);
    }

    // TODO: Nice place for messages like asking for upvotes and progressive onboarding

    await context.realtime.send('HOT_AND_COLD_GUESS_STREAM', { guess: guessToAdd });

    return {
      number: challenge,
      challengeStatus: hasSolved ? 'COMPLETED' : 'ACTIVE',
      // TODO: I think you can optimistically decrement this
      userAvailableGuesses: await ChallengeFaucet.getAvailableTokensForPlayer({
        challenge,
        redis: txn,
        username,
      }),
      challengeTopGuesses: await ChallengeGuesses.getTopGuessesForChallenge({
        challenge,
        redis: txn,
      }),
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
      },
      challengeInfo: newChallengeInfo,
    };
  }
);
