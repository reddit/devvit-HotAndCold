import { z } from 'zod';
import { redisNumberString } from '../utils';
import { fn } from '../../shared/fn';
import { redis, reddit, Post, settings, context } from '@devvit/web/server';
import { WordQueue } from './wordQueue';
import { getWordConfigCached } from './api';
import { Notifications } from './notifications';

export const stringifyValues = <T extends Record<string, any>>(obj: T): Record<keyof T, string> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, String(value)])
  ) as Record<keyof T, string>;
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
    return {
      challengeNumber,
      totalPlayers,
      totalSolves,
    } as const;
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
    z.object({ enqueueNotifications: z.boolean().optional() }).optional(),
    async (input) => {
      const enqueueNotifications = input?.enqueueNotifications ?? true;
      console.log('Making new challenge...');
      // Guard against manual double-creation in the same UTC day
      const today = new Date().toISOString().slice(0, 10);
      const postedKey = `challenge:posted:${today}`;
      const already = await redis.get(postedKey);
      if (already) {
        try {
          const parsed = JSON.parse(already) as { c?: number; postId?: string };
          const postId = parsed?.postId;
          let postUrl: string | undefined;
          if (postId) {
            try {
              const post = await reddit.getPostById(postId as any);
              postUrl = post.url;
            } catch {
              // ignore
            }
          }
          return {
            postId,
            postUrl,
            challenge: parsed?.c ?? (await getCurrentChallengeNumber()),
          } as const;
        } catch {
          // fall through to creation if parsing fails
        }
      }
      const [currentChallengeNumber, currentSubreddit] = await Promise.all([
        getCurrentChallengeNumber(),
        reddit.getCurrentSubreddit(),
      ]);

      const newChallengeNumber = currentChallengeNumber + 1;

      console.log('New challenge number:', newChallengeNumber);

      let post: Post | undefined;

      const newWord = (await WordQueue.shift())?.word;
      if (!newWord) {
        throw new Error('No more words available for new challenge. Need to add more to the list!');
      }

      try {
        // Sets the value in the redis cache for fast lookups
        await getWordConfigCached({ word: newWord });

        post = await reddit.submitCustomPost({
          subredditName: currentSubreddit.name,
          title: `Hot and cold #${newChallengeNumber}`,
          splash: {
            appDisplayName: 'Hot and Cold',
            backgroundUri: 'transparent.png',
          },
          postData: makePostData({
            challengeNumber: newChallengeNumber,
            totalPlayers: 0,
            totalSolves: 0,
          }),
        });

        // Pin the how-to-play comment
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
          // This is bugged as of 10/8 but maybe for only playtesting?
          console.error('Error pinning how-to-play comment:', error);
        }

        await setChallenge({
          challengeNumber: newChallengeNumber,
          config: {
            challengeNumber: newChallengeNumber.toString(),
            secretWord: newWord,
            totalPlayers: '0',
            totalSolves: '0',
            totalGuesses: '0',
            totalHints: '0',
            totalGiveUps: '0',
          },
        });

        await setPostIdForChallenge({ challengeNumber: newChallengeNumber, postId: post.id });

        await setCurrentChallengeNumber({ number: newChallengeNumber });

        console.log(
          'New challenge created:',
          'New Challenge Number:',
          newChallengeNumber,
          'New word:',
          newWord,
          'Post ID:',
          post.id
        );

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
            // Ensure notifications are only enqueued once per challenge
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
          } catch (e) {
            console.error('Failed to schedule reminder notifications', e);
          }
        }
        // Record daily marker after successful creation and setup
        await redis.set(postedKey, JSON.stringify({ c: newChallengeNumber, postId: post.id }));

        return {
          postId: post.id,
          postUrl: post.url,
          challenge: newChallengeNumber,
          word: newWord,
        };
      } catch (error) {
        console.error('Error making new challenge:', error);

        // If the transaction fails, remove the post if created
        if (post) {
          console.log(`Removing post ${post.id} due to new challenge error`);
          await reddit.remove(post.id, false);
        }

        throw error;
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
    // Daily idempotency using UTC date; lock with short TTL to avoid duplicate posts
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    const postedKey = `challenge:posted:${today}`;
    const lockKey = `challenge:ensure:${today}:lock`;

    // Fast path: if we've already recorded today's post, exit
    const readMarker = async (): Promise<{ c?: number; postId?: string } | null> => {
      const raw = await redis.get(postedKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as { c?: number; postId?: string };
      } catch {
        return null;
      }
    };

    const existing = await readMarker();
    if (existing) {
      return {
        status: 'exists' as const,
        challengeNumber: existing.c ?? (await getCurrentChallengeNumber()),
        postId: existing.postId ?? null,
      };
    }

    // Acquire short-lived creation lock (first writer proceeds)
    const claim = await redis.incrBy(lockKey, 1);
    if (claim === 1) {
      // Ensure lock auto-expires to allow later retries on failure
      await redis.expire(lockKey, 5 * 60);
    } else {
      return { status: 'skipped' as const };
    }

    // Double-check after acquiring the lock to avoid races
    const recheck = await readMarker();
    if (recheck) {
      return {
        status: 'exists' as const,
        challengeNumber: recheck.c ?? (await getCurrentChallengeNumber()),
        postId: recheck.postId ?? null,
      };
    }

    // Create the new challenge once and record the daily marker
    const created = await makeNewChallenge({ enqueueNotifications: true });
    await redis.set(postedKey, JSON.stringify({ c: created.challenge, postId: created.postId }));
    return {
      status: 'created' as const,
      challengeNumber: created.challenge,
      postId: created.postId,
    };
  });
}
