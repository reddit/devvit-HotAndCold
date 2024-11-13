import { z } from "zod";
import {
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy";
import { Challenge } from "./challenge";
import { API } from "./api";

export * as Guess from "./guess";

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
  startedPlayingAt: z.number().optional(),
  solvedAt: z.number().optional(),
  totalGuesses: z.number().optional(),
  gaveUpAt: z.number().optional(),
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
      startedPlayingAt: parseInt(result.startedPlayingAt, 10),
      solvedAt: parseInt(result.startedPlayingAt, 10),
      totalGuesses: parseInt(result.totalGuesses, 10),
      gaveUpAt: parseInt(result.gaveUpAt, 10),
      hints: JSON.parse(result.hints),
    });
  },
);

export const markChallengeSolvedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      solvedAt: Date.now().toString(),
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
      startedPlayingAt: Date.now().toString(),
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
      hints: JSON.stringify([...challengeUserInfo.hints, newHint]),
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

export const makeUserGuess = zoddy(
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

    if (challengeUserInfo.startedPlayingAt == null) {
      await Challenge.incrementChallengeTotalPlayers({ redis: txn, challenge });

      // sorta wasteful, but it works!
      await markChallengePlayedForUser({ challenge, redis: txn, username });
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

    await txn.zAdd(getChallengeUserGuessesDistanceKey(challenge, username), {
      member: guess,
      score: distance.similarity,
    });
    await incrementGuessesForChallengeForUser({
      challenge,
      redis: txn,
      username,
    });
    await Challenge.incrementChallengeTotalGuesses({ redis: txn, challenge });
    await txn.zAdd(getChallengeUserGuessesTimestampKey(challenge, username), {
      member: guess,
      score: Date.now(),
    });

    const hasSolved = distance.similarity === 1;
    if (distance.similarity === 1) {
      await markChallengeSolvedForUser({ challenge, redis: txn, username });
      await Challenge.incrementChallengeTotalSolves({ redis: txn, challenge });
    }

    await txn.exec();

    return {
      hasSolved,
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

    if (challengeUserInfo.startedPlayingAt == null) {
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
      gaveUpAt: Date.now().toString(),
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
