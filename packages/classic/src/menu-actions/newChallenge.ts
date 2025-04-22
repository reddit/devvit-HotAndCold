import { Devvit } from '@devvit/public-api';
import { ChallengeService } from '../core/challenge.js';

Devvit.addMenuItem({
  label: 'HotAndCold: New challenge',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    try {
      const newChallenge = await new ChallengeService(context.redis).makeNewChallenge({context: context});

      context.ui.navigateTo(newChallenge.postUrl);
    } catch (error) {
      console.error(`Error making new challenge:`, error);
    }
  },
});
