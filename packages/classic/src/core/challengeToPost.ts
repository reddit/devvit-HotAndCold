import { z } from 'zod';
import { zoddy, zodRedis } from '@hotandcold/shared/utils/zoddy';

export * as ChallengeToPost from './challengeToPost.js';

// Original to make it super explicit since we might let people play the archive on any postId
const getChallengeToOriginalPostKey = () => `challenge_to_original_post` as const;

export const getChallengeNumberForPost = zoddy(
  z.object({
    redis: zodRedis,
    postId: z.string().trim(),
  }),
  async ({ redis, postId }) => {
    const challengeNumber = await redis.zScore(getChallengeToOriginalPostKey(), postId);

    if (!challengeNumber) {
      throw new Error('No challenge number found for post. Did you mean to create one?');
    }
    return challengeNumber;
  }
);

export const getPostForChallengeNumber = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    const posts = await redis.zRange(getChallengeToOriginalPostKey(), challenge, challenge, {
      by: 'score',
    });

    if (!posts) {
      throw new Error('No post found for challenge number');
    }

    if (posts.length !== 1) {
      throw new Error('Multiple posts found for the same challenge number');
    }

    return posts[0].member;
  }
);

export const setChallengeNumberForPost = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    postId: z.string().trim(),
  }),
  async ({ redis, challenge, postId }) => {
    await redis.zAdd(getChallengeToOriginalPostKey(), {
      member: postId,
      score: challenge,
    });
  }
);
