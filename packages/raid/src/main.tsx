// Order matters here!
import './triggers/faucet.js';
import './triggers/install.js';
import './triggers/upgrade.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';
import './menu-actions/totalReminders.js';

import { Devvit, useChannel, useInterval, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { Challenge } from './core/challenge.js';
import { Guess } from './core/guess.js';
import { Preview } from './components/Preview.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { RedditApiCache } from './core/redditApiCache.js';
import { isServerCall, omit } from '@hotandcold/shared/utils';
import { sendMessageToWebview } from './utils/index.js';
import { ChallengeToStatus } from './core/challengeToStatus.js';
import { ChallengeGuesses } from './core/challengeGuesses.js';
import { ChallengeFaucet } from './core/challengeFaucet.js';
import { WebviewToBlocksMessage } from '@hotandcold/raid-shared';
import { Reminders } from './core/reminders.js';
import { CurrentPlayers } from './core/currentPlayers.js';

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
      challengeInfo: Awaited<ReturnType<(typeof Challenge)['getChallenge']>>;
      challengeUserInfo: Awaited<ReturnType<(typeof Guess)['getChallengeUserInfo']>>;
      challengeStatus: Awaited<
        ReturnType<(typeof ChallengeToStatus)['getStatusForChallengeNumber']>
      >;
      challengeTopGuesses: Awaited<
        ReturnType<(typeof ChallengeGuesses)['getTopGuessesForChallenge']>
      >;
      userAvailableGuesses: Awaited<
        ReturnType<(typeof ChallengeFaucet)['getAvailableTokensForPlayer']>
      >;
    };

// Add a post type definition
Devvit.addCustomPostType({
  name: 'HotAndCold',
  height: 'tall',
  render: (context) => {
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

      const [
        avatar,
        challengeInfo,
        challengeUserInfo,
        challengeStatus,
        challengeTopGuesses,
        userAvailableGuesses,
      ] = await Promise.all([
        RedditApiCache.getSnoovatarCached({
          context,
          username: user.username,
        }),
        Challenge.getChallenge({
          challenge: challenge,
          redis: context.redis,
        }),
        Guess.getChallengeUserInfo({
          challenge: challenge,
          redis: context.redis,
          username: user.username,
        }),
        ChallengeToStatus.getStatusForChallengeNumber({
          challenge,
          redis: context.redis,
        }),
        ChallengeGuesses.getTopGuessesForChallenge({
          challenge,
          redis: context.redis,
        }),
        ChallengeFaucet.getAvailableTokensForPlayer({
          challenge,
          redis: context.redis,
          username: user.username,
        }),
      ]);

      sendMessageToWebview(context, {
        type: 'INIT',
        payload: {
          challengeInfo: challengeInfo.solvedAtMs ? challengeInfo : omit(challengeInfo, ['word']),
          challengeStatus,
          challengeUserInfo,
          challengeTopGuesses,
          userAvailableGuesses,
          number: challenge,
        },
      });

      return {
        type: 'AUTHED' as const,
        user: { username: user.username, avatar },
        challenge,
        challengeInfo,
        challengeStatus,
        challengeUserInfo,
        challengeTopGuesses,
        userAvailableGuesses,
      };
    });

    // TODO: Show a teaser for the user
    if (initialState.type === 'UNAUTHED') {
      return <Preview text="Please login to play." />;
    }

    useInterval(async () => {
      const availableGuesses = await ChallengeFaucet.getAvailableTokensForPlayer({
        challenge: initialState.challenge,
        redis: context.redis,
        username: initialState.user.username,
      });

      sendMessageToWebview(context, {
        type: 'FAUCET_REPLENISH',
        payload: {
          availableGuesses,
        },
      });
    }, 10_000).start();

    useChannel({
      name: 'HOT_AND_COLD_GUESS_STREAM',
      onMessage: (message: any) => {
        // Don't emit messages sent by self
        if (message.guess.username === initialState.user.username) {
          return;
        }

        sendMessageToWebview(context, {
          type: 'NEW_GUESS_FROM_GUESS_STREAM',
          payload: {
            guess: message.guess,
          },
        });
      },
      onSubscribed: async () => {
        const playerCount = await CurrentPlayers.incrementPlayers({
          challenge: initialState.challenge,
          context,
        });

        sendMessageToWebview(context, {
          type: 'NEW_PLAYER_COUNT',
          payload: {
            playerCount,
          },
        });
      },
      onUnsubscribed: async () => {
        const playerCount = await CurrentPlayers.incrementPlayers({
          challenge: initialState.challenge,
          context,
        });

        sendMessageToWebview(context, {
          type: 'NEW_PLAYER_COUNT',
          payload: {
            playerCount,
          },
        });
      },
    }).subscribe();

    useChannel({
      name: 'RAID_SOLVED',
      onMessage: (message: any) => {
        // Don't emit messages sent by self
        if (message.challengeInfo.solvingUser === initialState.user.username) {
          return;
        }

        sendMessageToWebview(context, {
          type: 'RAID_SOLVED',
          payload: {
            challengeInfo: message.challengeInfo,
          },
        });
      },
    }).subscribe();

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
                const {
                  challengeInfo,
                  challengeUserInfo,
                  challenge,
                  challengeStatus,
                  challengeTopGuesses,
                  userAvailableGuesses,
                } = initialState;

                sendMessageToWebview(context, {
                  type: 'GAME_INIT_RESPONSE',
                  payload: {
                    challengeInfo: challengeInfo.solvedAtMs
                      ? challengeInfo
                      : omit(challengeInfo, ['word']),
                    challengeUserInfo,
                    number: challenge,
                    challengeStatus,
                    challengeTopGuesses,
                    userAvailableGuesses,
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
              case 'WORD_SUBMITTED':
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
              case 'SHOW_TOAST':
                context.ui.showToast(data.string);
                break;
              case 'TOGGLE_USER_REMINDER':
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
