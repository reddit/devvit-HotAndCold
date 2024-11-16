import { z } from "zod";
import { zoddy, zodRedis, zodTransaction } from "../utils/zoddy.js";

export * as ChallengeToPost from "./challengeToPost.js";

// Original to make it super explicit since we might let people play the archive on any postId
export const getChallengeToOriginalPostKey = () =>
  `challenge_to_original_post` as const;

export const getChallengeNumberForPost = zoddy(
  z.object({
    redis: zodRedis,
    postId: z.string().trim(),
  }),
  async ({ redis, postId }) => {
    const challengeNumber = await redis.zScore(
      getChallengeToOriginalPostKey(),
      postId,
    );

    if (!challengeNumber) {
      throw new Error(
        "No challenge number found for post. Did you mean to create one?",
      );
    }
    return challengeNumber;
  },
);

export const setChallengeNumberForPost = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
    postId: z.string().trim(),
  }),
  async ({ redis, challenge, postId }) => {
    await redis.zAdd(getChallengeToOriginalPostKey(), {
      member: postId,
      score: challenge,
    });
  },
);
