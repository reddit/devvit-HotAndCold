import { z } from "zod";
import { zoddy, zodRedditUsername, zodRedis } from "../utils/zoddy";

export * as ChallengeLeaderboard from "./challenge";

export const getChallengeLeaderboardKey = (challenge: number) =>
  `challenge:${challenge}:leaderboard` as const;

const challengeSchema = z.object({
  word: z.string().trim().toLowerCase(),
});

export const getLeaderboard = zoddy(
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
      getChallengeLeaderboardKey(challenge),
      start,
      stop,
      { by: "score", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(`No leaderboard found challenge ${challenge}`);
    }
    return result;
  },
);

export const addEntry = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    config: challengeSchema,
    username: zodRedditUsername,
    score: z.number().gte(0),
  }),
  async ({ redis, challenge, username, score }) => {
    await redis.zAdd(getChallengeLeaderboardKey(challenge), {
      member: username,
      score,
    });
  },
);
