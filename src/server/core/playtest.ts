import { context, reddit, redis } from '@devvit/web/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  PLAYTEST_CHALLENGE_BASE,
  PLAYTEST_RUN_TTL_SECONDS,
  isPlaytestContext,
  isTestChallengeNumber,
  type TestRun,
} from '../../shared/playtest';
import { Challenge } from './challenge';
import { ChallengeLeaderboard } from './challengeLeaderboard';
import { ChallengeProgress } from './challengeProgress';
import { UserGuess } from './userGuess';
import { User } from './user';
import { getWordConfigCached } from './api';

const fixtureSchema = z.object({ postId: z.string(), postUrl: z.string(), word: z.string() });
type Fixture = z.infer<typeof fixtureSchema>;
const fixtureKey = (postId: string) => `playtest:fixture:${postId}`;
const userRunKey = (postId: string) => `playtest:run:${postId}:${context.userId}`;
const creatorPostKey = () => `playtest:creator:${context.userId}:post`;

function requirePlaytest() {
  if (!isPlaytestContext(context) || !context.userId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'These tools require a playtest build.' });
  }
}

async function currentFixture(): Promise<Fixture> {
  requirePlaytest();
  if (!context.postId)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Open a test post first.' });
  const raw = await redis.get(fixtureKey(context.postId));
  if (!raw)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This is not a disposable test post.' });
  const fixture = fixtureSchema.parse(JSON.parse(raw));
  if (fixture.postId !== context.postId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Test post does not match this request.' });
  }
  return fixture;
}

export namespace Playtest {
  // Normal puzzles return immediately without touching Redis. Test-only keys
  // expire so repeated resets do not accumulate permanent player histories.
  export async function refreshRunExpiry(challengeNumber: number, username: string) {
    if (!isTestChallengeNumber(challengeNumber)) return;
    await Promise.all(
      [
        Challenge.ChallengeKey(challengeNumber),
        Challenge.ChallengePostIdKey(challengeNumber),
        UserGuess.Key(challengeNumber, username),
        ChallengeLeaderboard.ScoreKey(challengeNumber),
        ChallengeLeaderboard.FastestKey(challengeNumber),
        ChallengeProgress.StartKey(challengeNumber),
        ChallengeProgress.PlayerInfoHashKey(challengeNumber),
      ].map((key) => redis.expire(key, PLAYTEST_RUN_TTL_SECONDS))
    );
  }

  async function makeRun(fixture: Fixture, state: 'fresh' | 'solved'): Promise<TestRun> {
    const user = await User.getCurrent();
    const sequence = await redis.incrBy('playtest:run-sequence', 1);
    const challengeNumber = PLAYTEST_CHALLENGE_BASE + sequence;
    if (!Number.isSafeInteger(challengeNumber))
      throw new Error('Test run counter is out of range.');
    await Challenge.setChallenge({
      challengeNumber,
      config: {
        challengeNumber: String(challengeNumber),
        secretWord: fixture.word,
        totalPlayers: '0',
        totalSolves: '0',
        totalGuesses: '0',
        totalHints: '0',
        totalGiveUps: '0',
        postUrl: fixture.postUrl,
      },
    });
    await Challenge.setPostIdForChallenge({ challengeNumber, postId: fixture.postId });
    await redis.hSet(UserGuess.Key(challengeNumber, user.username), {
      username: user.username,
      guesses: '[]',
    });
    if (state === 'solved') {
      await UserGuess.submitGuesses({
        username: user.username,
        challengeNumber,
        guesses: [{ word: fixture.word, rank: 0, similarity: 1 }],
      });
    }
    await refreshRunExpiry(challengeNumber, user.username);
    await redis.set(userRunKey(fixture.postId), String(challengeNumber), {
      expiration: new Date(Date.now() + PLAYTEST_RUN_TTL_SECONDS * 1000),
    });
    return { challengeNumber, word: fixture.word, postUrl: fixture.postUrl };
  }

  export async function createPost(word: string) {
    requirePlaytest();
    await getWordConfigCached({ word });
    const previous = await redis.get(creatorPostKey());
    if (previous) {
      const raw = await redis.get(fixtureKey(previous));
      const fixture = raw ? fixtureSchema.parse(JSON.parse(raw)) : null;
      if (fixture?.word === word) {
        try {
          await reddit.getPostById(fixture.postId as `t3_${string}`);
          return { postUrl: fixture.postUrl };
        } catch {
          /* Recreate a deleted test post. */
        }
      }
    }
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName,
      title: `Hot and Cold Playtest — Test Word: ${word}`,
      entry: 'playtest',
      postData: { kind: 'playtest-game' },
    });
    const fixture: Fixture = { postId: post.id, postUrl: post.url, word };
    await redis.set(fixtureKey(post.id), JSON.stringify(fixture));
    await redis.set(creatorPostKey(), post.id);
    return { postUrl: post.url };
  }

  export async function getRun(): Promise<TestRun> {
    const fixture = await currentFixture();
    const raw = await redis.get(userRunKey(fixture.postId));
    const challengeNumber = Number(raw);
    if (isTestChallengeNumber(challengeNumber)) {
      const word = await redis.hGet(Challenge.ChallengeKey(challengeNumber), 'secretWord');
      if (word === fixture.word) return { challengeNumber, word, postUrl: fixture.postUrl };
    }
    return makeRun(fixture, 'fresh');
  }

  export async function resetRun(state: 'fresh' | 'solved', expectedChallengeNumber: number) {
    const fixture = await currentFixture();
    const current = Number(await redis.get(userRunKey(fixture.postId)));
    if (current !== expectedChallengeNumber || !isTestChallengeNumber(current)) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Reload to use your latest test run.',
      });
    }
    // A new ID gives this player fresh server and browser state. Requests from
    // the previous run can finish safely without restoring old guesses or wins.
    return makeRun(fixture, state);
  }
}
