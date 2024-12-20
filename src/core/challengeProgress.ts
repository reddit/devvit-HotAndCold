import { z } from "zod";
import {
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";
import { getChallengeKey } from "./challenge.js";
import { ChallengePlayers } from "./challengePlayers.js";
import { RedditApiCache } from "./redditApiCache.js";

export * as ChallengeProgress from "./challengeProgress.js";

export const getChallengePlayerProgressKey = (challenge: number) =>
  `${getChallengeKey(challenge)}:players:progress` as const;

export const getPlayerProgress = zoddy(
  z.object({
    context: zodContext,
    challenge: z.number().gt(0),
    username: zodRedditUsername,
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(["ASC", "DESC"]).optional().default("ASC"),
  }),
  async ({ context, challenge, sort, start, stop, username }) => {
    const result = await context.redis.zRange(
      getChallengePlayerProgressKey(challenge),
      start,
      stop,
      { by: "score", reverse: sort === "DESC" },
    );

    if (!result) {
      throw new Error(`No leaderboard found challenge ${challenge}`);
    }

    const players = await ChallengePlayers.getSome({
      redis: context.redis,
      challenge,
      usernames: result.map((x) => x.member),
    });

    // Filter out people who give up and people who haven't started
    const results = result.filter((x) => x.score > 1).map((x) => {
      const player = players[x.member];

      return {
        avatar: player?.avatar ?? null,
        username: x.member,
        isPlayer: x.member === username,
        progress: x.score,
      };
    });

    // If the user hasn't guessed yet, append it so they see themselves on the
    // meter. Don't save it because that will happen when they save and we
    // only want to see it in the UI.
    if (results.some((x) => x.isPlayer) === false) {
      // Sometimes users won't be in the returned sample so we do a check here to see if they have a score
      const score = await context.redis.zScore(
        getChallengePlayerProgressKey(challenge),
        username,
      );

      const avatar = await RedditApiCache.getSnoovatarCached({
        context,
        username,
      });

      results.push({
        avatar: avatar ?? null,
        username: username,
        isPlayer: true,
        // Default to 0 (this means they have not started)
        progress: score ?? 0,
      });
    }

    return results;
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
