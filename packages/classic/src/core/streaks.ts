import { z } from 'zod';
import { zoddy, zodRedditUsername, zodRedis, zodTransaction } from '@hotandcold/shared/utils/zoddy';
import { ChallengeLeaderboard } from './challengeLeaderboard.js';

export * as Streaks from './streaks.js';

export const getStreakKey = () => `streaks` as const;

export const getStreaksBackupKey = (challenge: number) => `streaks:backup:${challenge}` as const;

const challengeSchema = z
  .object({
    word: z.string().trim().toLowerCase(),
  })
  .strict();

export const getStreaks = zoddy(
  z.object({
    redis: zodRedis,
    start: z.number().gte(0).optional().default(0),
    stop: z.number().gte(-1).optional().default(10),
    sort: z.enum(['ASC', 'DESC']).optional().default('DESC'),
  }),
  async ({ redis, sort, start, stop }) => {
    // TODO: Total yolo
    const result = await redis.zRange(getStreakKey(), start, stop, {
      by: 'score',
      reverse: sort === 'DESC',
    });

    if (!result) {
      throw new Error(`No streaks leaderboard found!`);
    }
    return result;
  }
);

export const getStreakForMember = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const score = await redis.zScore(getStreakKey(), username);

    // Return 0 if member has no streak (instead of null)
    return score ?? 0;
  }
);

export const addEntry = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    config: challengeSchema,
    username: zodRedditUsername,
    score: z.number().gte(0),
  }),
  async ({ redis, username, score }) => {
    await redis.zAdd(getStreakKey(), {
      member: username,
      score,
    });
  }
);

export const incrementEntry = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    await redis.zIncrBy(getStreakKey(), username, 1);
  }
);

export const expireStreaks = zoddy(
  z.object({
    redis: zodRedis,
    // Since txn can't read you have to pass in both based on where this is going to be called
    txn: zodTransaction,
    /**
     * We don't want the newly created challenge. We want the one before that because
     * we want to expire streaks for the challenge that just ended.
     *
     * Can you tell I hard trouble naming this? lol
     */
    challengeNumberBeforeTheNewestChallenge: z.number().gt(0),
  }),
  async ({ redis, txn, challengeNumberBeforeTheNewestChallenge }) => {
    const [allStreaks, leaderboard] = await Promise.all([
      getStreaks({
        redis: redis,
        start: 0,
        stop: -1,
        sort: 'DESC',
      }),
      ChallengeLeaderboard.getLeaderboardByScore({
        redis: redis,
        challenge: challengeNumberBeforeTheNewestChallenge,
        start: 0,
        stop: 10,
        sort: 'DESC',
      }),
    ]);

    // Get usernames who participated in the latest challenge
    const leaderboardUsernames = new Set(leaderboard.map((entry) => entry.member));

    // Find streaks to expire (users who didn't participate)
    const streaksToExpire = allStreaks.filter((entry) => !leaderboardUsernames.has(entry.member));

    if (streaksToExpire.length === 0) {
      return;
    }

    // I'm paranoid that I'll screw up people's streaks and there will be a community
    // revolt. At least with this information I can restore it if I need to.
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    await txn.set(
      getStreaksBackupKey(challengeNumberBeforeTheNewestChallenge),
      JSON.stringify({
        streaksToExpire,
        allStreaks,
        leaderboard,
        timestamp: Date.now(),
      }),
      { expiration: thirtyDaysFromNow }
    );

    await txn.zRem(
      getStreakKey(),
      streaksToExpire.map((entry) => entry.member)
    );
  }
);
