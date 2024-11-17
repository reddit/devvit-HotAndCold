// Order matters here!
import './triggers/install.js';
import './triggers/upgrade.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';

import { Devvit, useAsync, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { isServerCall, omit, sendMessageToWebview } from './utils/utils.js';
import { WebviewToBlocksMessage } from '../game/shared.js';
import { Guess } from './core/guess.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { Preview } from './components/Preview.js';
import { Challenge } from './core/challenge.js';

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
    const [[username, challenge]] = useState<[string | null, number]>(async () => {
      return await Promise.all([
        context.reddit.getCurrentUser().then((user) => user?.username ?? null),
        ChallengeToPost.getChallengeNumberForPost({
          redis: context.redis,
          postId: context.postId!,
        }),
      ] as const);
    });

    if (!username) {
      return <Preview text="Please login to play." />;
    }

    // const challengeUserInfo = useState(async () => {
    //   return await Guess.getChallengeUserInfo({
    //     challenge,
    //     redis: context.redis,
    //     username,
    //   });
    // });

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
                const [challengeInfo, challengeUserInfo] = await Promise.all([
                  await Challenge.getChallenge({
                    challenge: challengeNumber,
                    redis: context.redis,
                  }),
                  await Guess.getChallengeUserInfo({
                    challenge: challengeNumber,
                    redis: context.redis,
                    username,
                  }),
                ]);

                sendMessageToWebview(context, {
                  type: 'GAME_INIT_RESPONSE',
                  payload: {
                    challengeInfo: omit(challengeInfo, ['word']),
                    challengeUserInfo,
                    number: challengeNumber,
                  },
                });
                break;
              case 'WORD_SUBMITTED':
                try {
                  sendMessageToWebview(context, {
                    type: 'WORD_SUBMITTED_RESPONSE',
                    payload: await Guess.submitGuess({
                      context,
                      challenge,
                      guess: data.value,
                      username,
                    }),
                  });
                } catch (error) {
                  isServerCall(error);

                  console.error('Error submitting guess:', error);
                  if (error instanceof Error) {
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
                      challenge,
                      username,
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
                      challenge,
                      username,
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
