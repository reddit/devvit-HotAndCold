import { Devvit } from '@devvit/public-api';
import { Challenge } from '../core/challenge.js';

Devvit.addMenuItem({
  label: 'HotAndCold: New challenge',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    try {
      const newChallenge = await Challenge.makeNewChallenge({ context });

      context.ui.navigateTo(newChallenge.postUrl);
    } catch (error) {
      console.error(`Error making new challenge:`, error);
    }
  },
});
