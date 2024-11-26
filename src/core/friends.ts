import { z } from "zod";
import {
  redisNumberString,
  zodContext,
  zoddy,
  zodJobContext,
  zodRedditUsername,
  zodRedis,
} from "../utils/zoddy.js";
import { Challenge } from "./challenge.js";
import { ChallengeToPost } from "./challengeToPost.js";

export * as Friends from "./friends.js";

export const getFriendsKey = (username: string) =>
  `friends:${username}` as const;

const friendshipSchema = z.object({
  status: z.enum(["PENDING", "DENIED", "ACCEPTED", "REMOVED"]),
  acceptedAtMs: redisNumberString.optional(),
  deniedAtMs: redisNumberString.optional(),
  requestedAtMs: redisNumberString.optional(),
  removedAtMs: redisNumberString.optional(),
}).strict();

export const makeFriendRequest = zoddy(
  z.object({
    context: z.union([zodContext, zodJobContext]),
    from: zodRedditUsername,
    to: zodRedditUsername,
  }),
  async ({ context, from, to }) => {
    // Weird contract, but we want to make sure someone can't get spam
    // friend requests from the same person.
    const existingFriendship = await getFriend({
      currentUser: to,
      friend: from,
      redis: context.redis,
    });

    if (existingFriendship.status === "PENDING") {
      throw new Error(
        "Friend request already sent. Please wait for a response.",
      );
    }
    if (existingFriendship.status === "ACCEPTED") {
      throw new Error(`You are already friends with ${from}`);
    }
    if (
      existingFriendship.status === "DENIED" ||
      existingFriendship.status === "REMOVED"
    ) {
      throw new Error(`Error sending friend request`);
    }

    const currentChallenge = await Challenge.getCurrentChallengeNumber({
      redis: context.redis,
    });
    const currentPost = await ChallengeToPost.getPostForChallengeNumber({
      redis: context.redis,
      challenge: currentChallenge,
    });
    const post = await context.reddit.getPostById(currentPost);

    await context.reddit.sendPrivateMessage({
      subject: "HotAndCold: New Friend request",
      text:
        `Hello, ${to}! **${from}** wants to be your friend. [Tap here](${post.url}) to accept.
        
Friends always appear on the same progress bar.
        `,
      to,
    });

    await context.redis.hSet(getFriendsKey(to), {
      [from]: JSON.stringify({
        requestedAtMs: Date.now(),
        status: "PENDING",
      }),
    });
  },
);

export const acceptFriendRequest = zoddy(
  z.object({
    redis: zodRedis,
    currentUser: zodRedditUsername,
    friend: zodRedditUsername,
  }),
  async ({ redis, currentUser, friend }) => {
    const friendRequest = await getFriend({
      currentUser,
      friend,
      redis,
    });

    if (friendRequest.status !== "PENDING") {
      throw new Error("Friend request already handled");
    }

    await redis.hSet(getFriendsKey(currentUser), {
      [friend]: JSON.stringify({
        ...friendRequest,
        status: "ACCEPTED",
        acceptedAtMs: Date.now(),
      }),
    });
  },
);

export const removeFriend = zoddy(
  z.object({
    redis: zodRedis,
    currentUser: zodRedditUsername,
    friend: zodRedditUsername,
  }),
  async ({ redis, currentUser, friend }) => {
    const friendRequest = await getFriend({
      currentUser,
      friend,
      redis,
    });

    if (friendRequest.status === "REMOVED") {
      throw new Error(`Friend request already removed`);
    }

    await redis.hSet(getFriendsKey(currentUser), {
      [friend]: JSON.stringify({
        ...friendRequest,
        status: "REMOVED",
        removedAtMs: Date.now(),
      }),
    });
  },
);

export const denyFriend = zoddy(
  z.object({
    redis: zodRedis,
    currentUser: zodRedditUsername,
    friend: zodRedditUsername,
  }),
  async ({ redis, currentUser, friend }) => {
    const friendRequest = await getFriend({
      currentUser,
      friend,
      redis,
    });

    if (!friendRequest) {
      throw new Error("Friend request not found");
    }

    if (friendRequest.status === "DENIED") {
      throw new Error("Friend request already denied");
    }

    await redis.hSet(getFriendsKey(currentUser), {
      [friend]: JSON.stringify({
        ...friendRequest,
        status: "DENIED",
        deniedAtMs: Date.now(),
      }),
    });
  },
);

/**
 * Pending and accepted friends.
 */
export const getAllFriends = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const friends = await redis.hGetAll(getFriendsKey(username));

    return Object.entries(friends).map(([key, value]) => (
      { username: key, ...friendshipSchema.parse(JSON.parse(value)) }
    ));
  },
);

/**
 * Only accepted friends.
 */
export const getCurrentFriends = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
  }),
  async ({ redis, username }) => {
    const friends = await getAllFriends({ redis, username });

    return friends.filter((friend) => friend.status === "ACCEPTED");
  },
);

export const getFriend = zoddy(
  z.object({
    redis: zodRedis,
    currentUser: zodRedditUsername,
    friend: zodRedditUsername,
  }),
  async ({ redis, currentUser, friend }) => {
    const friendRequest = await redis.hGet(
      getFriendsKey(currentUser),
      friend,
    );

    if (!friendRequest) {
      throw new Error("Friend request not found");
    }

    return friendshipSchema.parse(JSON.parse(friendRequest));
  },
);
