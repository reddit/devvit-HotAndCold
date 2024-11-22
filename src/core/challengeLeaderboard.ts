import { z } from "zod";
import {
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";

export * as ChallengeLeaderboard from "./challengeLeaderboard.js";

export const getChallengeLeaderboardScoreKey = (challenge: number) =>
  `challenge:${challenge}:leaderboard:score` as const;

export const getChallengeLeaderboardFastestKey = (challenge: number) =>
  `challenge:${challenge}:leaderboard:fastest` as const;

export const getLeaderboardByScore = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("DESC"),
  }),
  async ({ redis, challenge, sort, start, stop }) => {
    const result = await redis.zRange(
      getChallengeLeaderboardScoreKey(challenge),
      start,
      stop,
      { by: "rank", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(`No leaderboard found challenge ${challenge}`);
    }
    return result;
  },
);

export const getLeaderboardByFastest = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("DESC"),
  }),
  async ({ redis, challenge, sort, start, stop }) => {
    // TODO: Total yolo
    const result = await redis.zRange(
      getChallengeLeaderboardFastestKey(challenge),
      start,
      stop,
      { by: "rank", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(`No leaderboard found challenge ${challenge}`);
    }
    return result;
  },
);

export const addEntry = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
    username: zodRedditUsername,
    score: z.number().gte(0),
    timeToCompleteMs: z.number().gte(0),
  }),
  async ({ redis, challenge, username, score, timeToCompleteMs }) => {
    await redis.zAdd(getChallengeLeaderboardScoreKey(challenge), {
      member: username,
      score,
    });
    await redis.zAdd(getChallengeLeaderboardFastestKey(challenge), {
      member: username,
      score: timeToCompleteMs,
    });
  },
);

/**
 * Return 0 based! (0 is the best)
 *
 * I d
 */
export const getRankingsForMember = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    username: zodRedditUsername,
  }),
  async ({ redis, challenge, username }) => {
    // TODO: Workaround because we don't have zRevRank
    const totalPlayersOnLeaderboard = await redis.zCard(
      getChallengeLeaderboardScoreKey(challenge),
    );

    const score = await redis.zRank(
      getChallengeLeaderboardScoreKey(challenge),
      username,
    );
    const fastest = await redis.zRank(
      getChallengeLeaderboardFastestKey(challenge),
      username,
    );

    return {
      score: totalPlayersOnLeaderboard - (score ?? 0),
      timeToSolve: totalPlayersOnLeaderboard - (fastest ?? 0),
    };
  },
);
