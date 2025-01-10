import { z } from 'zod';
import { zoddy, zodRedis, zodTransaction } from '../utils/zoddy.js';

export * as ChallengeToWord from './challengeToWord.js';

// Original to make it super explicit since we might let people play the archive on any postId
export const getChallengeToWord = () => `challenge_to_word` as const;

export const getChallengeNumberForWord = zoddy(
  z.object({
    redis: zodRedis,
    word: z.string().trim(),
  }),
  async ({ redis, word }) => {
    const challengeNumber = await redis.zScore(getChallengeToWord(), word);

    if (!challengeNumber) {
      throw new Error('No challenge number found for word. Did you mean to create one?');
    }
    return challengeNumber;
  }
);

export const setChallengeNumberForWord = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    challenge: z.number().gt(0),
    word: z.string().trim(),
  }),
  async ({ redis, challenge, word }) => {
    await redis.zAdd(getChallengeToWord(), {
      member: word,
      score: challenge,
    });
  }
);

export const getAllUsedWords = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const words = await redis.zRange(getChallengeToWord(), 0, -1);

    return words.map((word) => word.member);
  }
);
