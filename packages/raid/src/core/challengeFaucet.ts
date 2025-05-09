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
        // You should never go below 0, but you never know....
        -10,
        // Don't give people at 10 an extra token!
        TOKEN_CEILING - 1,
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

  export const getAvailableTokensForPlayer = zoddy(
    z.object({
      redis: zodRedis,
      challenge: z.number().gt(0),
      username: zodRedditUsername,
    }),
    async ({ redis, challenge, username }) => {
      return (await redis.zScore(getChallengeFaucetKey(challenge), username)) ?? 10;
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
