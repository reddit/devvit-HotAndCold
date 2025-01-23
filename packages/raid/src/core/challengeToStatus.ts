import { z } from 'zod';
import { zoddy, zodRedis, zodTransaction } from '@hotandcold/shared/utils/zoddy';

export * as ChallengeToPost from './challengeToPost.js';

export namespace ChallengeToStatus {
  const STATUS_MAP = {
    ACTIVE: 0,
    COMPLETED: 1,
  } as const;
  const statusSchema = z.enum(['ACTIVE', 'COMPLETED']);

  // Create inverted map type
  type InvertMap<T extends Record<string, PropertyKey>> = {
    [P in T[keyof T]]: keyof T & string;
  };

  // Derive types from the map
  type Status = keyof typeof STATUS_MAP;
  type StatusNumber = (typeof STATUS_MAP)[Status];

  // Create inverted map
  const INVERTED_STATUS_MAP = Object.fromEntries(
    Object.entries(STATUS_MAP).map(([k, v]) => [v, k])
  ) as InvertMap<typeof STATUS_MAP>;

  // Type-safe conversion functions
  const statusToNumber = (status: Status): StatusNumber => {
    return STATUS_MAP[status];
  };

  const numberToStatus = (number: StatusNumber): Status => {
    return INVERTED_STATUS_MAP[number];
  };

  // Original to make it super explicit since we might let people play the archive on any postId
  export const getChallengeToStatusKey = () => `challenge_to_status` as const;

  export const getStatusForChallengeNumber = zoddy(
    z.object({
      redis: zodRedis,
      challenge: z.number().gt(0),
    }),
    async ({ redis, challenge }) => {
      const statusNumber = await redis.zScore(getChallengeToStatusKey(), challenge.toString());

      if (statusNumber == null) {
        throw new Error('No status number found for post. Did you mean to create one?');
      }
      return numberToStatus(statusNumber as 0 | 1);
    }
  );

  export const getChallengesByStatus = zoddy(
    z.object({
      redis: zodRedis,
      status: statusSchema,
    }),
    async ({ redis, status }) => {
      const statusNumber = statusToNumber(status);
      const challenges = await redis.zRange(getChallengeToStatusKey(), statusNumber, statusNumber, {
        by: 'score',
      });

      if (!challenges) {
        throw new Error('No challenges returned for given status');
      }

      return challenges.map((x) => ({
        challenge: Number(x.member),
        status: numberToStatus(statusNumber as 0 | 1),
      }));
    }
  );

  export const setStatusForChallenge = zoddy(
    z.object({
      redis: z.union([zodRedis, zodTransaction]),
      challenge: z.number().gt(0),
      status: statusSchema,
    }),
    async ({ redis, challenge, status }) => {
      await redis.zAdd(getChallengeToStatusKey(), {
        member: challenge.toString(),
        score: statusToNumber(status),
      });
    }
  );
}
