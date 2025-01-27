import { Devvit } from '@devvit/public-api';
import { Challenge } from '../core/challenge.js';

Devvit.addMenuItem({
  label: 'HotAndCold Raid: New challenge',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    try {
      const newChallenge = await Challenge.makeNewChallenge({ context });

      context.ui.navigateTo(newChallenge.postUrl);
    } catch (error) {
      console.error(`Error making new challenge:`, error);
      if (error instanceof Error) {
        context.ui.showToast(error.message);
      } else {
        context.ui.showToast(`An unknown error occurred.`);
      }
    }
  },
});
