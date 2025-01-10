import { Devvit, TriggerContext } from '@devvit/public-api';
import { WordList } from '../core/wordList.js';
import { Challenge } from '../core/challenge.js';
import { Reminders } from '../core/reminders.js';

Devvit.addSchedulerJob({
  name: 'DAILY_GAME_DROP',
  onRun: async (_, context) => {
    const newChallenge = await Challenge.makeNewChallenge({ context });

    const usernames = await Reminders.getUsersOptedIntoReminders({
      redis: context.redis,
    });

    const chunkSize = 25;
    for (let i = 0; i < usernames.length; i += chunkSize) {
      const chunk = usernames.slice(i, i + chunkSize);

      // Create array of promises for current chunk
      const promises = chunk.map((username) =>
        context.reddit.sendPrivateMessage({
          subject: `HotAndCold: Time to play challenge #${newChallenge.challenge}!`,
          text: `The new challenge is up! Go to [this link](${newChallenge.postUrl}) to play!\n\nUnsubscribe from these messages any time by going to the challenge, tapping the three dots, and selecting "Unsubscribe".`,
          to: username,
        })
      );

      // Wait for all promises in chunk to resolve
      const results = await Promise.allSettled(promises);
      let successCount = 0;
      let settledIndex = 0;
      for (const result of results) {
        if (result.status === 'rejected' && result.reason instanceof Error) {
          if (
            result.reason.message.includes('INVALID_USER') ||
            result.reason.message.includes('NO_USER') ||
            result.reason.message.includes('NOT_WHITELISTED_BY_USER_MESSAGE')
          ) {
            try {
              const userToRemove = chunk[settledIndex];
              console.log(
                `Removing user "${userToRemove}" from reminder list due to error: ${JSON.stringify(result.reason.message)}`
              );

              await Reminders.removeReminderForUsername({
                redis: context.redis,
                username: userToRemove,
              });
            } catch (error) {
              console.error(`Failed to remove user from reminder list: ${error}`);
            }
          } else {
            console.error(`Failed to send message to user: ${JSON.stringify(result.reason)}`);
          }
        } else {
          successCount++;
        }

        settledIndex++;
      }

      console.log(
        `Sent ${successCount} successfully out of ${chunk.length} messages to users out of ${usernames.length}.`
      );
    }
  },
});

export const initialize = async (context: TriggerContext) => {
  // Certain things need to be initialized in Redis to run correctly
  await WordList.initialize({ context });
  await Challenge.initialize({
    redis: context.redis,
  });

  let jobs = await context.scheduler.listJobs();
  for (let job of jobs) {
    await context.scheduler.cancelJob(job.id);
  }

  await context.scheduler.runJob({
    // Time is in UTC, so I think this is 8am? It's around there :D
    cron: '0 13 * * *',
    name: 'DAILY_GAME_DROP',
    data: {},
  });
};

Devvit.addTrigger({
  events: ['AppInstall'],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
