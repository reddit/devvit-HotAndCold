import { Context, Devvit } from '@devvit/public-api';
import { ChallengeService } from '../core/challenge.js';
import { GameMode } from '@hotandcold/classic-shared';

Devvit.addMenuItem({
  label: 'HotAndCold: New regular challenge',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    makeNewChallenge(context, 'regular');
  },
});

Devvit.addMenuItem({
  label: 'HotAndCold: New hardcore challenge',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    makeNewChallenge(context, 'hardcore');
  },
});

async function makeNewChallenge(context: Context, mode: GameMode) {
  try {
    const newChallenge = await new ChallengeService(context.redis, mode).makeNewChallenge({
      context: context,
    });

    context.ui.navigateTo(newChallenge.postUrl);
  } catch (error) {
    console.error(`Error making new challenge:`, error);
  }
}
