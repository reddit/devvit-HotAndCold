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
import { isEmptyObject } from "../utils/utils.js";

export * as Guess from "./guess.js";

export const getChallengeUserKey = (
  challengeNumber: number,
  username: string,
) => `${Challenge.getChallengeKey(challengeNumber)}:user:${username}` as const;

export const getChallengeUserGuessesDistanceKey = (
  challengeNumber: number,
  username: string,
) =>
  `${
    getChallengeUserKey(challengeNumber, username)
  }:guesses_by_distance` as const;

export const getChallengeUserGuessesTimestampKey = (
  challengeNumber: number,
  username: string,
) =>
  `${
    getChallengeUserKey(challengeNumber, username)
  }:guesses_by_timestamp` as const;

const challengeUserInfoSchema = z.object({
  startedPlayingAtMs: z.number().optional(),
  solvedAtMs: z.number().optional(),
  totalGuesses: z.number().optional(),
  gaveUpAtMs: z.number().optional(),
  hints: z.array(
    // TODO: Also include the rank 0-1000? Otherwise we need the client to see the word list to
    // calc and someone will hack us
    z.object({ word: z.string(), similarity: z.number().gte(-1).lte(1) }),
  ).optional(),
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
          gaveUpAtMs: "0",
          hints: "[]",
          solvedAtMs: "0",
          startedPlayingAtMs: "0",
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
  }),
  async ({ redis, username, challenge, completedAt }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      solvedAtMs: completedAt.toString(),
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
  async ({ context, username, challenge }) => {
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

    const givenSet = new Set(challengeUserInfo.hints?.map((x) => x.word) ?? []);

    // Filter out hints that have already been given
    const remainingHints = wordConfig.similar_words.filter((hint) =>
      !givenSet.has(hint.word)
    );

    if (remainingHints.length === 0) {
      console.warn(`No hints left for user ${username} on day ${challenge}`);
      return null;
    }

    // Get random index
    const randomIndex = Math.floor(Math.random() * remainingHints.length);
    const newHint = remainingHints[randomIndex];

    const txn = await context.redis.watch();
    await txn.multi();
    await Challenge.incrementChallengeTotalHints({ redis: txn, challenge });

    await txn.hSet(getChallengeUserKey(challenge, username), {
      hints: JSON.stringify([...challengeUserInfo.hints ?? [], newHint]),
    });

    await txn.exec();

    return newHint;
  },
);

export const getUserGuessesByDistance = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("DESC"),
  }),
  async ({ redis, challenge, username, sort, start, stop }) => {
    // TODO: Total yolo
    const result = await redis.zRange(
      getChallengeUserGuessesDistanceKey(challenge, username),
      start,
      stop,
      { by: "score", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(
        `No guesses found for user ${username} on day ${challenge}`,
      );
    }
    return result;
  },
);

export const getUserGuessesByTimestamp = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("DESC"),
  }),
  async ({ redis, challenge, username, sort, start, stop }) => {
    // TODO: Total yolo
    const result = await redis.zRange(
      getChallengeUserGuessesDistanceKey(challenge, username),
      start,
      stop,
      { by: "score", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(
        `No guesses found for user ${username} on day ${challenge}`,
      );
    }
    return result;
  },
);

export const submitGuess = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    guess: z.string().trim().toLowerCase(),
  }),
  async ({ context, username, challenge, guess }) => {
    console.log("1");
    await maybeInitForUser({ redis: context.redis, username, challenge });

    // TODO: Maybe I need to watch something here?
    const txn = await context.redis.watch();
    await txn.multi();

    console.log("2");
    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    console.log("3");
    if (challengeUserInfo.startedPlayingAtMs == null) {
      await Challenge.incrementChallengeTotalPlayers({ redis: txn, challenge });
      await markChallengePlayedForUser({ challenge, redis: txn, username });
    }

    console.log("4");
    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });
    console.log("5");

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }
    console.log("6");

    const distance = await API.compareWords({
      context,
      wordA: guess,
      wordB: challengeInfo.word,
    });

    if (distance.similarity == null) {
      throw new Error(`Sorry, I'm not familiar with that word.`);
    }
    console.log("7");

    await txn.zAdd(getChallengeUserGuessesDistanceKey(challenge, username), {
      member: guess,
      score: distance.similarity,
    });
    console.log("8");
    await incrementGuessesForChallengeForUser({
      challenge,
      redis: txn,
      username,
    });
    console.log("9");
    await Challenge.incrementChallengeTotalGuesses({ redis: txn, challenge });
    const guessToAdd = {
      member: guess,
      score: Date.now(),
    };
    console.log("10");
    await txn.zAdd(
      getChallengeUserGuessesTimestampKey(challenge, username),
      guessToAdd,
    );

    console.log("11");
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
        guesses: [
          ...await getUserGuessesByDistance({
            start: 0,
            stop: -1,
            redis: context.redis,
            username,
            challenge,
            sort: "DESC",
          }),
          guessToAdd,
        ],
        totalHints: challengeUserInfo.hints?.length ?? 0,
      });
      console.log("12");
      await markChallengeSolvedForUser({
        challenge,
        redis: txn,
        username,
        completedAt,
      });
      console.log("13");
      await Streaks.incrementEntry({ redis: txn, username });
      console.log("14");
      await Challenge.incrementChallengeTotalSolves({ redis: txn, challenge });
      console.log("15");
      await ChallengeLeaderboard.addEntry({
        redis: txn,
        challenge,
        username,
        score,
        timeToCompleteMs: solveTimeMs,
      });
    }

    await txn.exec();

    console.log("16");
    return {
      hasSolved,
      finalScore: score,
      similarity: distance.similarity,
      word: guess,
    };
  },
);

export const giveUp = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    guess: z.string().trim().toLowerCase(),
  }),
  async ({ context, username, challenge, guess }) => {
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

    // Add the guess even though they gave up so they can see the word later
    await txn.zAdd(getChallengeUserGuessesTimestampKey(challenge, username), {
      member: guess,
      score: Date.now(),
    });

    await Challenge.incrementChallengeTotalGiveUps({ redis: txn, challenge });

    await txn.exec();

    return;
  },
);
