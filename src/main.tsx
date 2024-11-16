// Order matters here!
import './triggers/install.js';
import './triggers/upgrade.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';

import { Devvit, useAsync, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { sendMessageToWebview } from './utils/utils.js';
import { WebviewToBlockMessage } from '../game/shared.js';
import { Guess } from './core/guess.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { Preview } from './components/Preview.js';

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

    useAsync(async () => {
      context.ui.webView.postMessage('webview', { hello: 'world' });

      return '';
    });

    if (!username) {
      return <Preview text="Please login to play." />;
    }

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview
          id="webview"
          url="index.html"
          width={'100%'}
          height={'100%'}
          onMessage={async (event) => {
            console.log('Received message', event);
            const data = event as unknown as WebviewToBlockMessage;

            switch (data.type) {
              case 'WORD_SUBMITTED':
                try {
                  const result = await Guess.submitGuess({
                    context,
                    challenge,
                    guess: data.value,
                    username,
                  });
                  sendMessageToWebview(context, {
                    type: 'WORD_SUBMITTED_RESPONSE',
                    payload: {
                      success: true,
                      hasSolved: result.hasSolved,
                      finalScore: result.finalScore,
                      similarity: result.similarity,
                      word: result.word,
                      // TODO: Normalized score?
                    },
                  });
                } catch (error) {
                  console.error('Error submitting guess:', error);
                  if (error instanceof Error) {
                    sendMessageToWebview(context, {
                      type: 'WORD_SUBMITTED_RESPONSE',
                      payload: {
                        success: false,
                        error: error.message,
                      },
                    });
                  }
                  sendMessageToWebview(context, {
                    type: 'WORD_SUBMITTED_RESPONSE',
                    payload: {
                      success: false,
                      error: `I'm not sure what happened. Please try again.`,
                    },
                  });
                }
                break;
              case 'SHOW_TOAST':
                context.ui.showToast(data.string);
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
