import { z } from "zod";
import { zoddy, zodRedis, zodTransaction } from "../utils/zoddy.js";

export * as User from "./user.js";

export const getUserKey = (username: string) => `user:${username}` as const;

const userSchema = z.object({
  optedIntoReminders: z.boolean(),
});

export const getUser = zoddy(
  z.object({
    redis: zodRedis,
    username: z.string().trim(),
  }),
  async ({ redis, username }) => {
    const user = await redis.get(getUserKey(username));

    if (!user) {
      throw new Error(`No user found for username ${username}`);
    }

    return userSchema.parse(JSON.parse(user));
  },
);

export const setUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: z.string().trim(),
    config: userSchema,
  }),
  async ({ redis, username, config }) => {
    await redis.set(getUserKey(username), JSON.stringify(config));
  },
);
