// Order matters here!
import './triggers/faucet.js';
import './triggers/install.js';
import './triggers/upgrade.js';
import './menu-actions/newChallenge.js';
import './menu-actions/addWordToDictionary.js';
import './menu-actions/totalReminders.js';

import { Devvit, useState } from '@devvit/public-api';
import { DEVVIT_SETTINGS_KEYS } from './constants.js';
import { Challenge } from './core/challenge.js';
import { Guess } from './core/guess.js';
import { Preview } from './components/Preview.js';
import { ChallengeToPost } from './core/challengeToPost.js';
import { RedditApiCache } from './core/redditApiCache.js';
import { omit } from '@hotandcold/shared/utils';
import { sendMessageToWebview } from './utils/index.js';
import { ChallengeToStatus } from './core/challengeToStatus.js';
import { ChallengeGuesses } from './core/challengeGuesses.js';
import { ChallengeFaucet } from './core/challengeFaucet.js';

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
          challengeInfo: omit(challengeInfo, ['word']),
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
        challengeUserInfo,
      };
    });

    // TODO: Show a teaser for the user
    if (initialState.type === 'UNAUTHED') {
      return <Preview text="Please login to play." />;
    }

    return (
      <vstack height="100%" width="100%" alignment="center middle">
        <webview id="webview" url="index.html" width={'100%'} height={'100%'} />
      </vstack>
    );
  },
});

export default Devvit;
