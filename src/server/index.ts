import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';
import { publicProcedure, router } from './trpc';
import { createContext } from './context';
import { createServer, getServerPort, redis } from '@devvit/web/server';
import { Challenge } from './core/challenge';
import { UserGuess } from './core/userGuess';
import { User } from './core/user';
import { ChallengeProgress } from './core/challengeProgress';
import { ChallengeLeaderboard } from './core/challengeLeaderboard';
import { LastPlayedAt } from './core/lastPlayedAt';
import { Reminders } from './core/reminder';
import { JoinedSubreddit } from './core/joinedSubreddit';
import { UserComment } from './core/userComment';
import { reddit, RichTextBuilder } from '@devvit/web/server';
import { FormattingFlag } from '@devvit/shared-types/richtext/types.js';

// Formats a duration in milliseconds to a human-readable long form like
// "2 hours 5 minutes 3 seconds" or "2 minutes 45 seconds" or "5 seconds".
function formatDurationLong(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || parts.length === 0)
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

async function computeCommentSuffix({
  username,
  challengeNumber,
}: {
  username: string;
  challengeNumber: number;
}): Promise<string> {
  const info = await UserGuess.getChallengeUserInfo({ username, challengeNumber });
  const start = info.startedPlayingAtMs ?? 0;
  const end = info.solvedAtMs ?? info.gaveUpAtMs ?? Date.now();
  const duration = formatDurationLong(end - start);
  const nonHintGuesses = (info.guesses ?? []).filter((g: any) => !g.isHint).length;
  const hintsUsed = (info.guesses ?? []).filter((g: any) => g.isHint).length;
  const score = info.score?.finalScore;
  const base = `I found the secret word in ${duration} after ${nonHintGuesses} ${
    nonHintGuesses === 1 ? 'guess' : 'guesses'
  } and ${hintsUsed} ${hintsUsed === 1 ? 'hint' : 'hints'}.`;
  return typeof score === 'number' ? `${base} Score: ${score}.` : base;
}

const appRouter = router({
  init: publicProcedure.query(async () => {
    console.log('inside of init');

    const resp = await fetch('https://en.wikipedia.org/wiki/Pauline_Ferrand-Pr%C3%A9vot');
    const html = await resp.text();
    console.log(html);

    return {
      challengeNumber: await Challenge.getCurrentChallengeNumber(),
      html,
    };
  }),
  user: {
    me: publicProcedure.query(async () => {
      const current = await User.getCurrent();
      return current;
    }),
  },
  cta: {
    getCallToAction: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;

        const [hasJoined, hasReminder, hasCommented] = await Promise.all([
          JoinedSubreddit.isUserJoinedSubreddit({ username }),
          Reminders.isUserOptedIntoReminders({ username }),
          UserComment.hasUserCommentedForChallenge({ username, challengeNumber }),
        ]);

        if (!hasJoined) return 'JOIN_SUBREDDIT' as const;
        if (!hasReminder) return 'REMIND_ME_TO_PLAY' as const;
        if (!hasCommented) return 'COMMENT' as const;
        return null;
      }),

    joinSubreddit: publicProcedure.input(z.object({})).mutation(async () => {
      await reddit.subscribeToCurrentSubreddit();
      const current = await User.getCurrent();
      await JoinedSubreddit.setJoinedSubredditForUsername({ username: current.username });
      return { success: true } as const;
    }),

    setReminder: publicProcedure.input(z.object({})).mutation(async () => {
      const current = await User.getCurrent();
      await Reminders.setReminderForUsername({ username: current.username });
      return { success: true } as const;
    }),

    getCommentSuffix: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber } = input;
        const current = await User.getCurrent();
        const username = current.username;
        const suffix = await computeCommentSuffix({ username, challengeNumber });
        return { suffix } as const;
      }),

    submitComment: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          comment: z.string().min(1).max(10000),
        })
      )
      .mutation(async ({ input }) => {
        const { challengeNumber, comment } = input;
        // Comment on the current challenge post
        const current = await User.getCurrent();

        // Prefer stored post ID for the challenge
        const postId = await Challenge.getPostIdForChallenge({ challengeNumber });
        if (!postId) {
          throw new Error('Could not find challenge post to comment on');
        }

        // Build richtext: main comment paragraph + small/superscript caption suffix paragraph
        const builder = new RichTextBuilder();
        builder.paragraph((p) => {
          p.text({ text: comment });
        });
        try {
          const suffix = await computeCommentSuffix({
            username: current.username,
            challengeNumber,
          });
          builder.paragraph((p) => {
            p.text({
              text: suffix,
              // Apply superscript to the entire suffix as a caption-like style
              formatting: [[FormattingFlag.superscript, 0, suffix.length]],
            });
          });
        } catch {
          // ignore suffix failure; just post the main comment
        }

        const id = postId as `t3_${string}`;
        await reddit.submitComment({ id, richtext: builder, runAs: 'USER' });

        await UserComment.setUserCommentedForChallenge({
          username: current.username,
          challengeNumber,
        });

        return { success: true } as const;
      }),
  },
  counter: {
    get: publicProcedure.query(async () => {
      const resp = await redis.get('counter');
      return resp ? parseInt(resp) : 0;
    }),
    increment: publicProcedure
      .input(
        z.object({
          amount: z.number().positive().default(1),
        })
      )
      .mutation(async ({ input }) => {
        const resp = await redis.incrBy('counter', input.amount);
        return resp;
      }),
    decrement: publicProcedure
      .input(
        z.object({
          amount: z.number().negative().default(-1),
        })
      )
      .mutation(async ({ input }) => {
        const resp = await redis.incrBy('counter', input.amount);
        return resp;
      }),
  },
  leaderboard: {
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          start: z.number().int().min(0).default(0),
          stop: z.number().int().min(-1).default(20),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber, start, stop } = input;
        const current = await User.getCurrent();
        const username = current.username;

        let leaderboardByScore: Array<{ member: string; score: number }> = [];
        try {
          leaderboardByScore = await ChallengeLeaderboard.getLeaderboardByScore({
            challengeNumber,
            start,
            stop,
            sort: 'DESC',
          });
        } catch {
          // no leaderboard yet – return empty
          leaderboardByScore = [];
        }

        let userRank: { score: number; timeToSolve: number } | null = null;
        if (leaderboardByScore.length > 0) {
          const zeroBased = await ChallengeLeaderboard.getRankingsForMember({
            challengeNumber,
            username,
          });
          // Convert to 1-based for UI display
          userRank = { score: zeroBased.score + 1, timeToSolve: zeroBased.timeToSolve + 1 };
        }

        return { leaderboardByScore, userRank } as const;
      }),
  },
  guess: {
    submitBatch: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          guesses: z.array(
            z.object({
              word: z.string(),
              similarity: z.number(),
              rank: z.number(),
              atMs: z.number(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const { challengeNumber, guesses } = input;
        const current = await User.getCurrent();
        const username = current.username;

        // Map to server core expected shape
        const mapped = guesses.map((g) => ({
          word: g.word,
          similarity: g.similarity,
          rank: g.rank,
        }));
        const response = await UserGuess.submitGuesses({
          username,
          challengeNumber,
          guesses: mapped,
        });
        // Track when the user last played
        try {
          await LastPlayedAt.setLastPlayedAtForUsername({ username });
        } catch (e) {
          console.error('Failed to record lastPlayedAt', e);
        }
        return response;
      }),
    giveUp: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;
        const response = await UserGuess.giveUp({ username, challengeNumber });
        return response;
      }),
  },
  game: {
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;
        const [challengeInfo, challengeUserInfo] = await Promise.all([
          Challenge.getChallenge({ challengeNumber }),
          UserGuess.getChallengeUserInfo({ username, challengeNumber }),
        ]);
        return {
          challengeNumber,
          challengeInfo,
          challengeUserInfo,
        };
      }),
  },
  progress: {
    nearestByStartTime: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          windowBefore: z.number().int().min(0).max(200).default(10),
          windowAfter: z.number().int().min(0).max(200).default(10),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;
        const neighbors = await ChallengeProgress.getNearestByStartTime({
          challengeNumber,
          username,
          windowBefore: input.windowBefore,
          windowAfter: input.windowAfter,
        });
        return neighbors;
      }),
  },
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;

const app = express();

app.use(
  '/api',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path, type, input }) {
      // Surface all procedure errors on the server for debugging/observability
      console.error('[tRPC error]', {
        path,
        type,
        message: error.message,
        cause: error.cause,
        input,
        stack: error.stack,
      });
    },
  })
);

app.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await Challenge.makeNewChallenge();

    res.json({
      navigateTo: post.postUrl,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

app.post('/internal/scheduler/create-new-challenge', async (_req, res): Promise<void> => {
  try {
    console.log('Creating new challenge from scheduler');
    await Challenge.makeNewChallenge();
    res.json({
      status: 'success',
    });
  } catch (error) {
    console.error(`Error creating new challenge from scheduler: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

createServer(app).listen(getServerPort());
