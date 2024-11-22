// Order matters here!
import './triggers/install.js';
import './triggers/upgrade.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';

import { Devvit, useInterval, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { isServerCall, omit, sendMessageToWebview } from './utils/utils.js';
import { WebviewToBlocksMessage } from '../game/shared.js';
import { Guess } from './core/guess.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { Preview } from './components/Preview.js';
import { Challenge } from './core/challenge.js';
import { ChallengeProgress } from './core/challengeProgress.js';
import { ChallengeLeaderboard } from './core/challengeLeaderboard.js';

Devvit.configure({
  redditAPI: true,
  http: true,
  redis: true,
  realtime: true,
});

Devvit.addSettings([
  {
    name: DEVVIT_SETTINGS_KEYS.WORD_SERVICE_API_KEY,
    label: 'API Key for Managed Word Service',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
]);

// Add a post type definition
Devvit.addCustomPostType({
  name: 'HotAndCold',
  height: 'tall',
  render: (context) => {
    const [initialState] = useState<{
      user: {
        username: string | null;
        avatar: string | null;
      } | null;
      challenge: number;
    }>(async () => {
      const [user, challenge] = await Promise.all([
        context.reddit.getCurrentUser(),
        ChallengeToPost.getChallengeNumberForPost({
          redis: context.redis,
          postId: context.postId!,
        }),
      ]);

      if (!user) {
        return {
          user: null,
          challenge,
        };
      }

      const avatar = await context.reddit.getSnoovatarUrl(user.username);

      return { user: { username: user.username, avatar: avatar ?? null }, challenge };
    });

    // TODO: Show a teaser for the user
    if (!initialState.user?.username) {
      return <Preview text="Please login to play." />;
    }

    useInterval(async () => {
      const challengeProgress = await ChallengeProgress.getPlayerProgress({
        challenge: initialState.challenge,
        redis: context.redis,
        sort: 'DESC',
        start: 0,
        stop: 10_000,
        username: initialState.user?.username!,
      });

      sendMessageToWebview(context, {
        type: 'PLAYER_PROGRESS_UPDATE',
        payload: {
          challengeProgress,
        },
      });
    }, 5000).start();

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="webview"
          url="index.html"
          width={'100%'}
          height={'100%'}
          onMessage={async (event) => {
            console.log('Received message', event);
            const data = event as unknown as WebviewToBlocksMessage;

            switch (data.type) {
              case 'GAME_INIT':
                const challengeNumber = await ChallengeToPost.getChallengeNumberForPost({
                  postId: context.postId!,
                  redis: context.redis,
                });
                const [challengeInfo, challengeUserInfo, challengeProgress] = await Promise.all([
                  Challenge.getChallenge({
                    challenge: challengeNumber,
                    redis: context.redis,
                  }),
                  Guess.getChallengeUserInfo({
                    challenge: challengeNumber,
                    redis: context.redis,
                    username: initialState.user?.username!,
                  }),
                  ChallengeProgress.getPlayerProgress({
                    challenge: initialState.challenge,
                    redis: context.redis,
                    sort: 'DESC',
                    start: 0,
                    stop: 10_000,
                    username: initialState.user?.username!,
                  }),
                ]);

                sendMessageToWebview(context, {
                  type: 'GAME_INIT_RESPONSE',
                  payload: {
                    challengeInfo: omit(challengeInfo, ['word']),
                    challengeUserInfo,
                    number: challengeNumber,
                    challengeProgress: challengeProgress,
                  },
                });
                break;
              case 'WORD_SUBMITTED':
                try {
                  sendMessageToWebview(context, {
                    type: 'WORD_SUBMITTED_RESPONSE',
                    payload: await Guess.submitGuess({
                      context,
                      challenge: initialState.challenge,
                      guess: data.value,
                      username: initialState.user?.username!,
                      avatar: initialState.user?.avatar!,
                    }),
                  });
                } catch (error) {
                  isServerCall(error);

                  console.error('Error submitting guess:', error);
                  // Sometimes the error is nasty and we don't want to show it
                  if (error instanceof Error && !['Error: 2'].includes(error.message)) {
                    context.ui.showToast(error.message);
                    return;
                  }
                  context.ui.showToast(`I'm not sure what happened. Please try again.`);
                }
                break;
              case 'SHOW_TOAST':
                context.ui.showToast(data.string);
                break;
              case 'HINT_REQUEST':
                try {
                  sendMessageToWebview(context, {
                    type: 'HINT_RESPONSE',
                    payload: await Guess.getHintForUser({
                      context,
                      challenge: initialState.challenge,
                      username: initialState.user?.username!,
                    }),
                  });
                } catch (error) {
                  isServerCall(error);

                  console.error('Error getting hint:', error);
                  if (error instanceof Error) {
                    context.ui.showToast(error.message);
                    return;
                  }
                  context.ui.showToast(`I'm not sure what happened. Please try again.`);
                }
                break;
              case 'GIVE_UP_REQUEST':
                try {
                  sendMessageToWebview(context, {
                    type: 'GIVE_UP_RESPONSE',
                    payload: await Guess.giveUp({
                      context,
                      challenge: initialState.challenge,
                      username: initialState.user?.username!,
                    }),
                  });
                } catch (error) {
                  if (error instanceof Error) {
                    context.ui.showToast(error.message);
                    return;
                  }
                  context.ui.showToast(`I'm not sure what happened. Please try again.`);
                }
                break;
              case 'LEADERBOARD_FOR_CHALLENGE':
                const leaderboardByScore = await ChallengeLeaderboard.getLeaderboardByScore({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  start: 0,
                  stop: 10,
                  sort: 'DESC',
                });
                console.log('Leaderboard by score:', leaderboardByScore);
                const leaderboardByFastest = await ChallengeLeaderboard.getLeaderboardByFastest({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  start: 0,
                  stop: 10,
                  sort: 'DESC',
                });
                const userRank = await ChallengeLeaderboard.getRankingsForMember({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  username: initialState.user?.username!,
                });
                sendMessageToWebview(context, {
                  type: 'CHALLENGE_LEADERBOARD_RESPONSE',
                  payload: {
                    leaderboardByScore,
                    leaderboardByFastest,
                    userRank,
                  },
                });
                break;

              default:
                throw new Error(`Unknown message type: ${data satisfies never}`);
            }
          }}
        />
      </vstack>
    );
  },
});

export default Devvit;
