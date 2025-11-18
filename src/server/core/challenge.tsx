import { z } from 'zod';
import { redisNumberString } from '../utils';
import { fn } from '../../shared/fn';
import { redis, reddit, Post, settings, context } from '@devvit/web/server';
import { WordQueue } from './wordQueue';
import { getWordConfigCached } from './api';
import { Notifications } from './notifications';

export const stringifyValues = <T extends Record<string, any>>(
  obj: T
): Partial<Record<keyof T, string>> => {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  ) as Partial<Record<keyof T, string>>;
};

const CHALLENGE_PUBLISH_LOCK_KEY = 'challenge:publish:lock';
const CHALLENGE_PUBLISH_LOCK_TTL_SECONDS = 60;

const DAILY_POST_WINDOW_MS = 23 * 60 * 60 * 1000; // allow 1-hour cushion for cron jitter

type ChallengePostSnapshot = {
  challengeNumber: number;
  postId: string;
  postUrl: string | null;
  createdAt: Date;
};

type ChallengeCreationResult = {
  postId: string;
  postUrl: string;
  challenge: number;
  word: string;
};

const tryAcquireChallengePublishLock = async (): Promise<boolean> => {
  const claim = await redis.incrBy(CHALLENGE_PUBLISH_LOCK_KEY, 1);
  if (claim === 1) {
    await redis.expire(CHALLENGE_PUBLISH_LOCK_KEY, CHALLENGE_PUBLISH_LOCK_TTL_SECONDS);
    return true;
  }
  await redis.incrBy(CHALLENGE_PUBLISH_LOCK_KEY, -1);
  return false;
};

const releaseChallengePublishLock = async (): Promise<void> => {
  try {
    await redis.del(CHALLENGE_PUBLISH_LOCK_KEY);
  } catch (error) {
    console.error('Failed to release challenge publish lock', error);
  }
};

const getLatestChallengePostSnapshot = async (): Promise<ChallengePostSnapshot | null> => {
  const challengeNumber = await Challenge.getCurrentChallengeNumber();
  if (challengeNumber <= 0) {
    return null;
  }
  const postId = await Challenge.getPostIdForChallenge({ challengeNumber });
  if (!postId) {
    return null;
  }

  try {
    const post = await reddit.getPostById(postId as any);
    return {
      challengeNumber,
      postId,
      postUrl: post.url ?? null,
      createdAt: post.createdAt,
    };
  } catch (error) {
    console.error('Failed to load latest challenge post from Reddit', {
      challengeNumber,
      postId,
      error,
    });
    return null;
  }
};

const getChallengeWithinWindow = async (
  windowMs: number
): Promise<ChallengePostSnapshot | null> => {
  const snapshot = await getLatestChallengePostSnapshot();
  if (!snapshot) return null;
  const ageMs = Date.now() - snapshot.createdAt.getTime();
  if (Number.isFinite(ageMs) && ageMs < windowMs) {
    return snapshot;
  }
  return null;
};

const createChallengePost = async ({
  enqueueNotifications,
}: {
  enqueueNotifications: boolean;
}): Promise<ChallengeCreationResult> => {
  console.log('Making new challenge...');

  const [currentChallengeNumber, currentSubreddit] = await Promise.all([
    Challenge.getCurrentChallengeNumber(),
    reddit.getCurrentSubreddit(),
  ]);

  const newChallengeNumber = currentChallengeNumber + 1;
  const newWord = (await WordQueue.shift())?.word;

  if (!newWord) {
    throw new Error('No more words available for new challenge. Need to add more to the list!');
  }

  let post: Post | undefined;

  try {
    await getWordConfigCached({ word: newWord });

    post = await reddit.submitCustomPost({
      subredditName: currentSubreddit.name,
      title: `Hot and cold #${newChallengeNumber}`,
      splash: {
        appDisplayName: 'Hot and Cold',
        backgroundUri: 'transparent.png',
      },
      postData: Challenge.makePostData({
        challengeNumber: newChallengeNumber,
        totalPlayers: 0,
        totalSolves: 0,
      }),
    });

    try {
      const comment = await reddit.submitComment({
        id: post.id,
        text: `Welcome to Hot and Cold, the delightfully frustrating word guessing game! 
        
To play, guess the secret word by typing any word you think is related.

For example, if the secret word is "hot":

Guesses: banana -> #12956 (not close); sun -> #493 (getting warmer); hotdog -> #220 (hot); cold -> #42 (hot); freeze -> #1657 (getting colder); warm -> #15 (very hot!!); hot -> WINNER!

The rank is based on how AI models see the relationships between the words. So antonyms can be "close" by the relationship of the words (cold -> hot). Additionally, words can be close based on the structure of the word (hotdog -> hot).

Enjoy! If you have feedback on how we can improve the game, please let us know!
  `,
      });
      await comment.distinguish(true);
    } catch (error) {
      console.error('Error pinning how-to-play comment:', error);
    }

    await Challenge.setChallenge({
      challengeNumber: newChallengeNumber,
      config: {
        challengeNumber: newChallengeNumber.toString(),
        secretWord: newWord,
        totalPlayers: '0',
        totalSolves: '0',
        totalGuesses: '0',
        totalHints: '0',
        totalGiveUps: '0',
        postUrl: post.url,
      },
    });

    await Challenge.setPostIdForChallenge({ challengeNumber: newChallengeNumber, postId: post.id });
    await Challenge.setCurrentChallengeNumber({ number: newChallengeNumber });

    const flairId = await settings.get<string>('flairId');
    if (flairId) {
      await reddit.setPostFlair({
        postId: post.id,
        subredditName: context.subredditName!,
        flairTemplateId: flairId,
      });
    } else {
      console.warn('No flair ID configured, skipping...');
    }

    if (enqueueNotifications) {
      try {
        const notifKey = `notifications:enqueued:ch:${newChallengeNumber}`;
        const first = await redis.incrBy(notifKey, 1);
        if (first === 1) {
          await Notifications.enqueueNewChallengeByTimezone({
            challengeNumber: newChallengeNumber,
            postId: post.id,
            postUrl: post.url,
          });
        } else {
          console.log('Notifications already enqueued for challenge', newChallengeNumber);
        }
      } catch (error) {
        console.error('Failed to schedule reminder notifications', error);
      }
    }

    return {
      postId: post.id,
      postUrl: post.url,
      challenge: newChallengeNumber,
      word: newWord,
    };
  } catch (error) {
    console.error('Error making new challenge:', error);
    if (post) {
      try {
        console.log(`Removing post ${post.id} due to new challenge error`);
        await reddit.remove(post.id, false);
      } catch (removeError) {
        console.error('Failed to remove post after challenge error', removeError);
      }
    }
    throw error;
  }
};

const ensureChallengeWithinWindow = async ({
  enqueueNotifications,
  enforceWindow,
}: {
  enqueueNotifications: boolean;
  enforceWindow: boolean;
}): Promise<
  | { kind: 'existing'; snapshot: ChallengePostSnapshot }
  | { kind: 'created'; created: ChallengeCreationResult }
> => {
  if (enforceWindow) {
    const existing = await getChallengeWithinWindow(DAILY_POST_WINDOW_MS);
    if (existing) {
      return { kind: 'existing', snapshot: existing };
    }
  }
  const created = await createChallengePost({ enqueueNotifications });
  return { kind: 'created', created };
};

export namespace Challenge {
  // Shared builder to keep postData in sync everywhere it's set
  export const makePostData = ({
    challengeNumber,
    totalPlayers,
    totalSolves,
  }: {
    challengeNumber: number;
    totalPlayers: number;
    totalSolves: number;
  }) => {
    const data: {
      challengeNumber: number;
      totalPlayers: number;
      totalSolves: number;
    } = {
      challengeNumber,
      totalPlayers,
      totalSolves,
    };
    return data;
  };
  export const CurrentChallengeNumberKey = () => 'current_challenge_number' as const;

  export const ChallengeKey = (challengeNumber: number) => `challenge:${challengeNumber}` as const;
  export const ChallengePostIdKey = (challengeNumber: number) =>
    `challenge:${challengeNumber}:postId` as const;

  const challengeSchema = z
    .object({
      challengeNumber: z.string(),
      secretWord: z.string(),
      totalPlayers: redisNumberString.optional(),
      totalSolves: redisNumberString.optional(),
      totalGuesses: redisNumberString.optional(),
      totalHints: redisNumberString.optional(),
      totalGiveUps: redisNumberString.optional(),
      postUrl: z.string().min(1).optional(),
    })
    .strict();

  export const getCurrentChallengeNumber = fn(z.void(), async () => {
    const currentChallengeNumber = await redis.get(Challenge.CurrentChallengeNumberKey());

    if (!currentChallengeNumber) {
      // Default to 0 if not set
      return 0;
    }

    return parseInt(currentChallengeNumber);
  });

  export const incrementCurrentChallengeNumber = fn(z.void(), async () => {
    await redis.incrBy(Challenge.CurrentChallengeNumberKey(), 1);
  });

  export const setCurrentChallengeNumber = fn(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      await redis.set(Challenge.CurrentChallengeNumberKey(), number.toString());
    }
  );

  export const getChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const result = await redis.hGetAll(Challenge.ChallengeKey(challengeNumber));

      if (!result) {
        throw new Error('No challenge found');
      }
      return challengeSchema.parse(result);
    }
  );

  export const setChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      config: challengeSchema,
    }),
    async ({ challengeNumber, config }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), stringifyValues(config));
    }
  );

  export const setPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      postId: z.string(),
    }),
    async ({ challengeNumber, postId }) => {
      await redis.set(ChallengePostIdKey(challengeNumber), postId);
    }
  );

  export const getPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const postId = await redis.get(ChallengePostIdKey(challengeNumber));
      return postId ?? null;
    }
  );

  export const initialize = fn(z.void(), async () => {
    const result = await redis.get(Challenge.CurrentChallengeNumberKey());
    if (!result) {
      await redis.set(Challenge.CurrentChallengeNumberKey(), '0');
    } else {
      console.log('Challenge key already initialized');
    }
  });

  export const incrementChallengeTotalPlayers = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalPlayers', 1);
    }
  );

  export const incrementChallengeTotalSolves = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalSolves', 1);
    }
  );

  export const incrementChallengeTotalGuesses = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalGuesses', 1);
    }
  );

  export const incrementChallengeTotalHints = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalHints', 1);
    }
  );

  export const incrementChallengeTotalGiveUps = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalGiveUps', 1);
    }
  );

  export const makeNewChallenge = fn(
    z
      .object({
        enqueueNotifications: z.boolean().default(true),
        ignoreDailyWindow: z.boolean().default(false),
      })
      .default({ enqueueNotifications: true, ignoreDailyWindow: false }),
    async ({ enqueueNotifications, ignoreDailyWindow }) => {
      const lockAcquired = await tryAcquireChallengePublishLock();
      if (!lockAcquired) {
        throw new Error('Challenge creation already in progress. Please try again shortly.');
      }

      try {
        const outcome = await ensureChallengeWithinWindow({
          enqueueNotifications,
          enforceWindow: !ignoreDailyWindow,
        });

        if (outcome.kind === 'existing') {
          const { snapshot } = outcome;
          return {
            challenge: snapshot.challengeNumber,
            postId: snapshot.postId,
            postUrl: snapshot.postUrl ?? undefined,
          };
        }

        return outcome.created;
      } finally {
        await releaseChallengePublishLock();
      }
    }
  );

  export const exportLast30Days = fn(z.void(), async () => {
    const currentChallengeNumber = await getCurrentChallengeNumber();

    // Assume roughly 1 challenge per day and get last 30 challenges
    // If there are gaps in challenge numbers, we'll filter them out
    const startChallengeNumber = Math.max(1, currentChallengeNumber - 30);
    const challengeNumbers = Array.from(
      { length: currentChallengeNumber - startChallengeNumber + 1 },
      (_, i) => startChallengeNumber + i
    );

    // Query all challenges in the range
    const challenges = await Promise.all(
      challengeNumbers.map(async (challengeNumber) => {
        try {
          const challenge = await getChallenge({ challengeNumber });
          return {
            challengeNumber: parseInt(challenge.challengeNumber),
            secretWord: challenge.secretWord,
            totalPlayers: challenge.totalPlayers ?? 0,
            totalSolves: challenge.totalSolves ?? 0,
            totalGuesses: challenge.totalGuesses ?? 0,
            totalHints: challenge.totalHints ?? 0,
            totalGiveUps: challenge.totalGiveUps ?? 0,
          };
        } catch (error) {
          console.error('Error getting challenge for stat export:', error);
          // Challenge doesn't exist, skip it
          return null;
        }
      })
    );

    // Filter out null challenges and sort by challenge number (newest first)
    const validChallenges = challenges
      .filter((challenge): challenge is NonNullable<typeof challenge> => challenge !== null)
      .sort((a, b) => b.challengeNumber - a.challengeNumber);

    return validChallenges;
  });

  // Updates postData for the most recent N challenges (including current)
  export const updatePostDataForRecentChallenges = fn(z.void(), async () => {
    const current = await getCurrentChallengeNumber();
    if (current <= 0) return { updated: 0 } as const;

    const maxToUpdate = 10;
    let updated = 0;

    for (let i = 0; i < maxToUpdate; i++) {
      const challengeNumber = current - i;
      if (challengeNumber <= 0) break;

      try {
        const postId = await getPostIdForChallenge({ challengeNumber });
        if (!postId) continue;

        // Load latest counters for this challenge
        const c = await getChallenge({ challengeNumber });
        const totalPlayers = Number.parseInt(String(c.totalPlayers ?? '0'), 10) || 0;
        const totalSolves = Number.parseInt(String(c.totalSolves ?? '0'), 10) || 0;

        const post = await reddit.getPostById(postId as any);
        await post.setPostData(
          makePostData({
            challengeNumber,
            totalPlayers,
            totalSolves,
          })
        );
        updated++;
      } catch (err) {
        console.error('Failed to update postData for challenge', challengeNumber, err);
        // continue with the rest
      }
    }

    return { updated } as const;
  });

  export const ensureLatestClassicPostOrRetry = fn(z.void(), async () => {
    const lockAcquired = await tryAcquireChallengePublishLock();
    if (!lockAcquired) {
      return { status: 'skipped' as const };
    }

    try {
      const outcome = await ensureChallengeWithinWindow({
        enqueueNotifications: true,
        enforceWindow: true,
      });

      if (outcome.kind === 'existing') {
        return {
          status: 'exists' as const,
          challengeNumber: outcome.snapshot.challengeNumber,
          postId: outcome.snapshot.postId,
        };
      }

      return {
        status: 'created' as const,
        challengeNumber: outcome.created.challenge,
        postId: outcome.created.postId,
      };
    } finally {
      await releaseChallengePublishLock();
    }
  });
}
