import { z } from "zod";
import {
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";
import { Challenge } from "./challenge.js";
import { API } from "./api.js";
import { Streaks } from "./streaks.js";
import { ChallengeLeaderboard } from "./challengeLeaderboard.js";
import { Score } from "./score.js";
import { isEmptyObject, omit } from "../utils/utils.js";
import { GameResponse } from "../../game/shared.js";

export * as Guess from "./guess.js";

export const getChallengeUserKey = (
  challengeNumber: number,
  username: string,
) => `${Challenge.getChallengeKey(challengeNumber)}:user:${username}` as const;

export const guessSchema = z.object({
  word: z.string(),
  similarity: z.number().gte(-1).lte(1),
  timestamp: z.number(),
  // Only for top 1,000 similar words
  rank: z.number().gte(-1),
  isHint: z.boolean(),
});

const challengeUserInfoSchema = z.object({
  finalScore: z.number().optional(),
  startedPlayingAtMs: z.number().optional(),
  solvedAtMs: z.number().optional(),
  totalGuesses: z.number().optional(),
  gaveUpAtMs: z.number().optional(),
  guesses: z.array(guessSchema).optional(),
});

export const getChallengeUserInfo = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(
      getChallengeUserKey(challenge, username),
    );

    if (!result) {
      throw new Error(`No user found for ${username} on day ${challenge}`);
    }

    return challengeUserInfoSchema.parse({
      finalScore: result.finalScore
        ? parseInt(result.finalScore, 10)
        : undefined,
      startedPlayingAtMs: result.startedPlayingAtMs
        ? parseInt(result.startedPlayingAtMs, 10)
        : undefined,
      solvedAtMs: result.solvedAtMs
        ? parseInt(result.solvedAtMs, 10)
        : undefined,
      totalGuesses: result.totalGuesses
        ? parseInt(result.totalGuesses, 10)
        : undefined,
      gaveUpAtMs: result.gaveUpAtMs
        ? parseInt(result.gaveUpAtMs, 10)
        : undefined,
      guesses: JSON.parse(result.guesses ?? "[]"),
      hints: JSON.parse(result.hints ?? "[]"),
    });
  },
);

const maybeInitForUser = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(
      getChallengeUserKey(challenge, username),
    );

    if (!result || isEmptyObject(result)) {
      await redis.hSet(
        getChallengeUserKey(challenge, username),
        {
          totalGuesses: "0",
          finalScore: "0",
          guesses: "[]",
          // These will be set as dates!
          solvedAtMs: "",
          gaveUpAtMs: "",
          startedPlayingAtMs: "",
        } satisfies Record<keyof z.infer<typeof challengeUserInfoSchema>, any>,
      );
    }
  },
);

export const markChallengeSolvedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    completedAt: z.number(),
    finalScore: z.number(),
  }),
  async ({ redis, username, challenge, completedAt, finalScore }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      solvedAtMs: completedAt.toString(),
      finalScore: finalScore.toString(),
    });
  },
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
  },
);

export const incrementGuessesForChallengeForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    await redis.hIncrBy(
      getChallengeUserKey(challenge, username),
      "totalGuesses",
      1,
    );
  },
);

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
    const wordConfig = await API.getWordConfig({
      context,
      word: challengeInfo.word,
    });
    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    const givenSet = new Set(
      challengeUserInfo.guesses?.map((x) => x.word) ?? [],
    );

    // Filter out hints that have already been given
    const remainingHints = wordConfig.similar_words.filter((hint) =>
      !givenSet.has(hint.word)
    );

    if (remainingHints.length === 0) {
      throw new Error(`I don't have any more hints for you. Give up?`);
    }

    // Get random index
    const randomIndex = Math.floor(Math.random() * remainingHints.length);
    const newHint = remainingHints[randomIndex];

    const hintToAdd: z.infer<typeof guessSchema> = {
      word: newHint.word,
      timestamp: Date.now(),
      similarity: newHint.similarity,
      rank: wordConfig.similar_words.findIndex((x) => x.word === newHint.word),
      isHint: true,
    };

    const txn = await context.redis.watch();
    await txn.multi();

    await Challenge.incrementChallengeTotalHints({ redis: txn, challenge });

    // Hints count as guesses
    await incrementGuessesForChallengeForUser({
      challenge,
      redis: txn,
      username,
    });

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify([...challengeUserInfo.guesses ?? [], hintToAdd]),
    });

    await txn.exec();

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: [...challengeUserInfo.guesses ?? [], hintToAdd],
      },
      challengeInfo: omit(challengeInfo, ["word"]),
    };
  },
);

export const submitGuess = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    guess: z.string().trim().toLowerCase(),
  }),
  async ({ context, username, challenge, guess }): Promise<GameResponse> => {
    await maybeInitForUser({ redis: context.redis, username, challenge });

    // TODO: Maybe I need to watch something here?
    const txn = await context.redis.watch();
    await txn.multi();

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    // Empty string check since we initially set it! Added other falsies just in case
    if (!challengeUserInfo.startedPlayingAtMs) {
      await Challenge.incrementChallengeTotalPlayers({ redis: txn, challenge });
      await markChallengePlayedForUser({ challenge, redis: txn, username });
    }

    if (
      challengeUserInfo.guesses && challengeUserInfo.guesses.length > 0 &&
      challengeUserInfo.guesses.find((x) => x.word === guess)
    ) {
      throw new Error(`You've already guessed ${guess}.`);
    }

    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }

    const distance = await API.compareWords({
      context,
      wordA: guess,
      wordB: challengeInfo.word,
    });

    if (distance.similarity == null) {
      throw new Error(`Sorry, I'm not familiar with that word.`);
    }

    const wordConfig = await API.getWordConfig({
      context,
      word: challengeInfo.word,
    });

    await incrementGuessesForChallengeForUser({
      challenge,
      redis: txn,
      username,
    });

    await Challenge.incrementChallengeTotalGuesses({ redis: txn, challenge });
    const guessToAdd: z.infer<typeof guessSchema> = {
      word: guess,
      timestamp: Date.now(),
      similarity: distance.similarity,
      rank: wordConfig.similar_words.findIndex((x) => x.word === guess),
      isHint: false,
    };

    const newGuesses = [...challengeUserInfo.guesses ?? [], guessToAdd];

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    const hasSolved = distance.similarity === 1;
    let score: number | undefined = undefined;
    if (hasSolved) {
      if (!challengeUserInfo.startedPlayingAtMs) {
        throw new Error(
          `User ${username} has not started playing yet but solved?`,
        );
      }
      const completedAt = Date.now();
      const solveTimeMs = completedAt - challengeUserInfo.startedPlayingAtMs;
      score = Score.calculateScore({
        solveTimeMs,
        // Need to manually add guess here since this runs in a transaction
        // and the guess has not been added to the user's guesses yet
        guesses: newGuesses,
        totalHints: challengeUserInfo.guesses?.filter((x) =>
          x.isHint
        )?.length ?? 0,
      });

      await markChallengeSolvedForUser({
        challenge,
        redis: txn,
        username,
        completedAt,
        finalScore: score,
      });

      await Streaks.incrementEntry({ redis: txn, username });

      await Challenge.incrementChallengeTotalSolves({ redis: txn, challenge });

      await ChallengeLeaderboard.addEntry({
        redis: txn,
        challenge,
        username,
        score,
        timeToCompleteMs: solveTimeMs,
      });
    }

    await txn.exec();

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
      },
      challengeInfo: omit(challengeInfo, ["word"]),
    };
  },
);

export const giveUp = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ context, username, challenge }): Promise<GameResponse> => {
    // TODO: Maybe I need to watch something here?
    const txn = await context.redis.watch();
    await txn.multi();

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
      rank: 0,
      isHint: true,
    };

    const newGuesses = [...challengeUserInfo.guesses ?? [], guessToAdd];

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    await Challenge.incrementChallengeTotalGiveUps({ redis: txn, challenge });

    await txn.exec();

    return {
      number: challenge,
      challengeUserInfo,
      challengeInfo: omit(challengeInfo, ["word"]),
    };
  },
);
