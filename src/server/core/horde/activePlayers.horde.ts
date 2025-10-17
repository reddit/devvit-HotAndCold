import { z } from 'zod';
import { fn } from '../../../shared/fn';
import { redis } from '@devvit/web/server';

export namespace HordeActivePlayers {
  export const ACTIVE_PLAYERS_INTERVAL_SECONDS = 30;
  export const ACTIVE_PLAYERS_LOOKBACK_WINDOW = 3;
  const THREE_DAYS_IN_SECONDS = 3 * 24 * 60 * 60;

  export const ActivePlayersKey = (challengeNumber: number) =>
    `horde:challenge:${challengeNumber}:activePlayers` as const;

  function getIntervalStartTimestamp(intervalSeconds: number, offset: number = 0): number {
    const intervalMs = intervalSeconds * 1000;
    return Math.floor(Date.now() / intervalMs - offset) * intervalMs;
  }

  function getLastNIntervalTimestamps(intervalSeconds: number, lookBackWindow: number): number[] {
    const intervals: number[] = [];
    for (let i = 0; i < lookBackWindow; i++) {
      intervals.push(getIntervalStartTimestamp(intervalSeconds, i));
    }
    return intervals;
  }

  // Increment the active players counter for the current 30s bucket
  export const increment = fn(
    z.object({ challengeNumber: z.number().gt(0) }),
    async ({ challengeNumber }) => {
      const interval = getIntervalStartTimestamp(ACTIVE_PLAYERS_INTERVAL_SECONDS).toString();
      const key = ActivePlayersKey(challengeNumber);
      const value = await redis.zIncrBy(key, interval, 1);
      // Ensure keys do not grow without bound
      await redis.expire(key, THREE_DAYS_IN_SECONDS);
      console.log(
        `Increment active players for challenge ${challengeNumber} to ${value} for interval ${interval}`
      );
    }
  );

  // Estimate currently active players by averaging last N buckets
  export const get = fn(
    z.object({ challengeNumber: z.number().gt(0) }),
    async ({ challengeNumber }) => {
      const lastNTimestamps = getLastNIntervalTimestamps(
        ACTIVE_PLAYERS_INTERVAL_SECONDS,
        ACTIVE_PLAYERS_LOOKBACK_WINDOW
      );
      const key = ActivePlayersKey(challengeNumber);
      const results = await Promise.all(
        lastNTimestamps.map((timestamp) => redis.zScore(key, timestamp.toString()))
      );
      const sum = results.reduce<number>((acc, x) => acc + (x ?? 0), 0);
      const avg = Math.ceil(sum / ACTIVE_PLAYERS_LOOKBACK_WINDOW || 1);
      return avg;
    }
  );
}
