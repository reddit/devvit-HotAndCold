import { z } from 'zod';
import { zodRedditUsername, zodRedis, zodTransaction, zoddy } from '@hotandcold/shared/utils/zoddy';
import { Challenge } from './challenge.js';

export namespace ChallengeFaucet {
  const TOKEN_CEILING = 10;
  const TOKEN_START = TOKEN_CEILING;
  const TOKEN_INCREMENT = 1;

  const getChallengeFaucetKey = (challenge: number) =>
    `${Challenge.getChallengeKey(challenge)}:players:faucet`;

  export const replenishFaucet = zoddy(
    z.object({
      challenge: z.number().gt(0),
      redis: zodRedis,
    }),
    async (args) => {
      const usersToIncrement = await args.redis.zRange(
        getChallengeFaucetKey(args.challenge),
        0,
        TOKEN_CEILING,
        {
          by: 'score',
        }
      );

      for (const user of usersToIncrement) {
        await args.redis.zIncrBy(
          getChallengeFaucetKey(args.challenge),
          user.member,
          TOKEN_INCREMENT
        );
      }
    }
  );

  export const addPlayerFaucet = zoddy(
    z.object({
      redis: z.union([zodRedis, zodTransaction]),
      challenge: z.number().gt(0),
      username: zodRedditUsername,
    }),
    async ({ redis, challenge, username }) => {
      await redis.zAdd(getChallengeFaucetKey(challenge), {
        member: username,
        score: TOKEN_START,
      });
    }
  );

  export const consumeTokenForPlayer = zoddy(
    z.object({
      challenge: z.number().gt(0),
      redis: zodRedis,
      username: zodRedditUsername,
    }),
    async (args) => {
      return await args.redis.zIncrBy(getChallengeFaucetKey(args.challenge), args.username, -1);
    }
  );
}
