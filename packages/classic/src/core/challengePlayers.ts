import { z } from 'zod';
import { zoddy, zodRedditUsername, zodRedis, zodTransaction } from '@hotandcold/shared/utils/zoddy';
import { Challenge } from './challenge.js';

export * as ChallengePlayers from './challengePlayers.js';

export const getChallengePlayersKey = (challenge: number) =>
  `${Challenge.getChallengeKey(challenge)}:players` as const;

export const playersSchema = z.record(
  z.string(),
  z.object({
    avatar: z.string().nullable(),
  })
);

export const setPlayer = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    avatar: z.string().nullable(),
    challenge: z.number().gt(0),
  }),
  async ({ redis, avatar, username, challenge }) => {
    return await redis.hSet(getChallengePlayersKey(challenge), {
      [username]: JSON.stringify({ avatar }),
    });
  }
);

type PlayerSchema = z.infer<typeof playersSchema>;

export const getAll = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
  }),
  async ({ redis, challenge }) => {
    const items = await redis.hGetAll(getChallengePlayersKey(challenge));

    const players: PlayerSchema = {};

    Object.entries(items).forEach(([username, data]) => {
      players[username] = JSON.parse(data) as PlayerSchema[string];
    });

    return playersSchema.parse(players);
  }
);

export const getSome = zoddy(
  z.object({
    redis: zodRedis,
    challenge: z.number().gt(0),
    usernames: z.array(z.string()),
  }),
  async ({ redis, challenge, usernames }) => {
    if (usernames.length === 0) return {};

    const items = await redis.hMGet(getChallengePlayersKey(challenge), usernames);

    const players: Record<string, string | null> = {};

    items.forEach((raw, index) => {
      players[usernames[index]] = JSON.parse(raw ?? '{}') as (typeof players)['string'];
    });

    return playersSchema.parse(players);
  }
);
