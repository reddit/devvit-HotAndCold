import { z } from "zod";
import {
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";

export * as Reminders from "./reminders.js";

// Original to make it super explicit since we might let people play the archive on any postId
export const getChallengeToWord = () => `reminders` as const;

export const setReminderForUsername = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    await redis.zAdd(getChallengeToWord(), {
      member: username,
      score: 1,
    });
  },
);

export const isUserOptedIntoReminders = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const score = await redis.zScore(getChallengeToWord(), username);

    return score === 1;
  },
);

export const removeReminderForUsername = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    await redis.zRem(getChallengeToWord(), [username]);
  },
);

export const getUsersOptedIntoReminders = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const users = await redis.zRange(getChallengeToWord(), 1, 1, {
      by: "score",
    });

    return users.map((user) => user.member);
  },
);

export const toggleReminderForUsername = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const isOptedIn = await isUserOptedIntoReminders({ redis, username });

    if (isOptedIn) {
      await removeReminderForUsername({ redis, username });
      return { newValue: false };
    } else {
      await setReminderForUsername({ redis, username });
      return { newValue: true };
    }
  },
);
