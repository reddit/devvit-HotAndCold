import { z } from "zod";
import {
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";

export * as Players from "./players.js";

export const getChallengePlayersKey = () => `players` as const;

export const playersSchema = z.record(
  z.string(),
  z.object({
    avatar: z.string().nullable(),
  }),
);

export const setPlayer = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    avatar: z.string().nullable(),
  }),
  async ({ redis, avatar, username }) => {
    return await redis.hSet(getChallengePlayersKey(), {
      [username]: JSON.stringify({ avatar }),
    });
  },
);

export const getAll = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const items = await redis.hGetAll(getChallengePlayersKey());

    const players: z.infer<typeof playersSchema> = {};

    Object.entries(items).forEach(([username, data]) => {
      players[username] = JSON.parse(data);
    });

    return playersSchema.parse(players);
  },
);
