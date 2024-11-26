import { z } from "zod";
import {
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";
import { getChallengeKey } from "./challenge.js";
import { ChallengePlayers } from "./challengePlayers.js";

export * as ChallengeProgress from "./challengeProgress.js";

export const getChallengePlayerProgressKey = (challenge: number) =>
  `${getChallengeKey(challenge)}:players:progress` as const;

export const getPlayerProgress = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    username: zodRedditUsername,
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("DESC"),
  }),
  async ({ redis, challenge, sort, start, stop, username }) => {
    const players = await ChallengePlayers.getAll({ redis, challenge });

    // TODO: Total yolo
    const result = await redis.zRange(
      getChallengePlayerProgressKey(challenge),
      start,
      stop,
      { by: "score", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(`No leaderboard found challenge ${challenge}`);
    }

    return result.map((x) => {
      const player = players[x.member];

      return {
        avatar: player?.avatar ?? null,
        username: x.member,
        isPlayer: x.member === username,
        progress: x.score,
      };
    });
  },
);

export const getEntry = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    username: zodRedditUsername,
  }),
  async ({ redis, challenge, username }) => {
    const result = await redis.zScore(
      getChallengePlayerProgressKey(challenge),
      username,
    );

    return result;
  },
);

export const upsertEntry = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
    username: zodRedditUsername,
    // -1 means gave up
    progress: z.number().gte(-1).lte(100),
  }),
  async ({ redis, challenge, username, progress }) => {
    await redis.zAdd(getChallengePlayerProgressKey(challenge), {
      member: username,
      score: progress,
    });
  },
);
