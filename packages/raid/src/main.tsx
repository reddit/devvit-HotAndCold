// Order matters here!
// import './triggers/install.js';
// import './triggers/upgrade.js';
// import './triggers/onComment.js';
// import './menu-actions/newChallenge.js';
// import './menu-actions/addWordToDictionary.js';
// import './menu-actions/totalReminders.js';

import { Devvit, useChannel, useInterval, useState } from '@devvit/public-api';
import { WebviewToBlocksMessage } from '@hotandcold/classic-shared';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';

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
      // challengeInfo: Awaited<ReturnType<(typeof Challenge)['getChallenge']>>;
      // challengeUserInfo: Awaited<ReturnType<(typeof Guess)['getChallengeUserInfo']>>;
      // challengeProgress: Awaited<ReturnType<(typeof ChallengeProgress)['getPlayerProgress']>>;
    };

// Add a post type definition
Devvit.addCustomPostType({
  name: 'HotAndCold',
  height: 'tall',
  render: (context) => {
    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview id="webview" url="index.html" width={'100%'} height={'100%'} />
      </vstack>
    );
  },
});

export default Devvit;
