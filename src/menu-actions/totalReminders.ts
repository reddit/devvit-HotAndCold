import { Devvit } from '@devvit/public-api';
import { Reminders } from '../core/reminders.js';

Devvit.addMenuItem({
  label: 'HotAndCold: Get total reminders',
  forUserType: 'moderator',
  location: 'subreddit',
  onPress: async (_event, context) => {
    try {
      const total = await Reminders.totalReminders({ redis: context.redis });

      context.ui.showToast(`Total game reminders: ${total}`);
    } catch (error) {
      console.error(`Error making new challenge:`, error);
    }
  },
});
