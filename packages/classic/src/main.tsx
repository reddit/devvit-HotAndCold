// Order matters here!
import './triggers/install.js';
import './triggers/upgrade.js';
import './triggers/onComment.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';
import './menu-actions/totalReminders.js';

import { Devvit, useInterval, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { isServerCall, omit } from '@hotandcold/shared/utils';
import { WebviewToBlocksMessage } from '@hotandcold/classic-shared';
import { Guess } from './core/guess.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { Preview } from './components/Preview.js';
import { ChallengeService } from './core/challenge.js';
import { ChallengeProgress } from './core/challengeProgress.js';
import { ChallengeLeaderboard } from './core/challengeLeaderboard.js';
import { Reminders } from './core/reminders.js';
import { RedditApiCache } from './core/redditApiCache.js';
import { sendMessageToWebview } from './utils/index.js';
import { initPayments } from './payments.js';

initPayments();

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

type InitialState =
  | {
      type: 'UNAUTHED';
      user: null;
      challenge: number;
    }
  | {
      type: 'AUTHED';
      user: {
        username: string;
        avatar: string | null;
      };
      challenge: number;
      challengeInfo: Awaited<ReturnType<ChallengeService['getChallenge']>>;
      challengeUserInfo: Awaited<ReturnType<(typeof Guess)['getChallengeUserInfo']>>;
      challengeProgress: Awaited<ReturnType<(typeof ChallengeProgress)['getPlayerProgress']>>;
    };

// Add a post type definition
Devvit.addCustomPostType({
  name: 'HotAndCold',
  height: 'tall',
  render: (context) => {
    const challengeService = new ChallengeService(context.redis);
    const [initialState] = useState<InitialState>(async () => {
      const [user, challenge] = await Promise.all([
        context.reddit.getCurrentUser(),
        ChallengeToPost.getChallengeNumberForPost({
          redis: context.redis,
          postId: context.postId!,
        }),
      ]);
      if (!user) {
        return {
          type: 'UNAUTHED' as const,
          user: null,
          challenge,
        };
      }

      // Rate limits things
      const [avatar, challengeInfo, challengeUserInfo, challengeProgress] = await Promise.all([
        RedditApiCache.getSnoovatarCached({
          context,
          username: user.username,
        }),
        challengeService.getChallenge({
          challenge: challenge,
        }),
        Guess.getChallengeUserInfo({
          challenge: challenge,
          redis: context.redis,
          username: user.username,
        }),
        ChallengeProgress.getPlayerProgress({
          challenge: challenge,
          context,
          sort: 'DESC',
          start: 0,
          stop: 10_000,
          username: user.username,
        }),
      ]);

      // sendMessageToWebview(context, {
      //   type: 'INIT',
      //   payload: {
      //     challengeInfo: omit(challengeInfo, ['word']),
      //     challengeUserInfo,
      //     number: challenge,
      //     challengeProgress: challengeProgress,
      //   },
      // });

      return {
        type: 'AUTHED' as const,
        user: { username: user.username, avatar },
        challenge,
        challengeInfo,
        challengeUserInfo,
        challengeProgress,
      };
    });

    // TODO: Show a teaser for the user
    if (initialState.type === 'UNAUTHED') {
      return <Preview text="Please login to play." />;
    }

    useInterval(async () => {
      const challengeProgress = await ChallengeProgress.getPlayerProgress({
        challenge: initialState.challenge,
        context,
        sort: 'DESC',
        start: 0,
        stop: 20,
        username: initialState.user.username,
      });

      sendMessageToWebview(context, {
        type: 'PLAYER_PROGRESS_UPDATE',
        payload: {
          challengeProgress,
        },
      });
    }, 6000).start();

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="webview"
          url="index.html"
          width={'100%'}
          height={'100%'}
          onMessage={async (event) => {
            const data = event as unknown as WebviewToBlocksMessage;

            switch (data.type) {
              case 'GAME_INIT': {
                const { challengeInfo, challengeUserInfo, challengeProgress, challenge } =
                  initialState;

                sendMessageToWebview(context, {
                  type: 'GAME_INIT_RESPONSE',
                  payload: {
                    mode: 'regular', // TODO: Get this from the backend
                    challengeInfo: omit(challengeInfo, ['word']),
                    challengeUserInfo,
                    number: challenge,
                    challengeProgress: challengeProgress,
                  },
                });

                const isUserOptedIntoReminders = await Reminders.isUserOptedIntoReminders({
                  redis: context.redis,
                  username: initialState.user.username,
                });

                sendMessageToWebview(context, {
                  type: 'TOGGLE_USER_REMINDER_RESPONSE',
                  payload: {
                    isUserOptedIntoReminders,
                  },
                });

                break;
              }
              case 'WORD_SUBMITTED': {
                try {
                  sendMessageToWebview(context, {
                    type: 'WORD_SUBMITTED_RESPONSE',
                    payload: await Guess.submitGuess({
                      context,
                      challenge: initialState.challenge,
                      guess: data.value,
                      username: initialState.user.username,
                      avatar: initialState.user.avatar,
                    }),
                  });
                } catch (error) {
                  isServerCall(error);

                  console.error('Error submitting guess:', error);
                  // Sometimes the error is nasty and we don't want to show it
                  if (error instanceof Error && !['Error: 2'].includes(error.message)) {
                    sendMessageToWebview(context, {
                      type: 'FEEDBACK',
                      payload: {
                        feedback: error.message,
                      },
                    });
                    // context.ui.showToast(error.message);
                    return;
                  }
                  sendMessageToWebview(context, {
                    type: 'FEEDBACK',
                    payload: {
                      feedback: `I'm not sure what happened. Please try again.`,
                    },
                  });
                }
                break;
              }
              case 'SHOW_TOAST': {
                context.ui.showToast(data.string);
                break;
              }
              case 'HINT_REQUEST': {
                try {
                  sendMessageToWebview(context, {
                    type: 'HINT_RESPONSE',
                    payload: await Guess.getHintForUser({
                      context,
                      challenge: initialState.challenge,
                      username: initialState.user.username,
                    }),
                  });
                } catch (error) {
                  isServerCall(error);

                  console.error('Error getting hint:', error);
                  if (error instanceof Error) {
                    sendMessageToWebview(context, {
                      type: 'FEEDBACK',
                      payload: {
                        feedback: error.message,
                      },
                    });
                    return;
                  }
                  sendMessageToWebview(context, {
                    type: 'FEEDBACK',
                    payload: {
                      feedback: `I'm not sure what happened. Please try again.`,
                    },
                  });
                }
                break;
              }
              case 'GIVE_UP_REQUEST': {
                try {
                  sendMessageToWebview(context, {
                    type: 'GIVE_UP_RESPONSE',
                    payload: await Guess.giveUp({
                      context,
                      challenge: initialState.challenge,
                      username: initialState.user.username,
                    }),
                  });
                } catch (error) {
                  console.error(`Error giving up:`, error);
                  if (error instanceof Error) {
                    sendMessageToWebview(context, {
                      type: 'FEEDBACK',
                      payload: {
                        feedback: error.message,
                      },
                    });
                    return;
                  }
                  sendMessageToWebview(context, {
                    type: 'FEEDBACK',
                    payload: {
                      feedback: `I'm not sure what happened. Please try again.`,
                    },
                  });
                }
                break;
              }
              case 'LEADERBOARD_FOR_CHALLENGE': {
                const leaderboardByScore = await ChallengeLeaderboard.getLeaderboardByScore({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  start: 0,
                  stop: 9,
                  sort: 'DESC',
                });
                console.log('Leaderboard by score:', leaderboardByScore);
                const leaderboardByFastest = await ChallengeLeaderboard.getLeaderboardByFastest({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  start: 0,
                  stop: 9,
                  sort: 'DESC',
                });
                const userRank = await ChallengeLeaderboard.getRankingsForMember({
                  challenge: initialState?.challenge,
                  redis: context.redis,
                  username: initialState.user.username,
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
              }
              case 'TOGGLE_USER_REMINDER': {
                const resp = await Reminders.toggleReminderForUsername({
                  redis: context.redis,
                  username: initialState.user.username,
                });

                sendMessageToWebview(context, {
                  type: 'TOGGLE_USER_REMINDER_RESPONSE',
                  payload: {
                    isUserOptedIntoReminders: resp.newValue,
                  },
                });

                if (resp.newValue) {
                  context.ui.showToast(`You will now receive reminders to play!`);
                } else {
                  context.ui.showToast(`You will no longer receive reminders to play.`);
                }
                break;
              }

              default:
                throw new Error(`Unknown message type: ${String(data satisfies never)}`);
            }
          }}
        />
      </vstack>
    );
  },
});

export default Devvit;
