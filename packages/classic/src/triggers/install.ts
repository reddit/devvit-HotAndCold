import { Devvit, TriggerContext } from '@devvit/public-api';
import { WordListService } from '../core/wordList.js';
import { ChallengeService } from '../core/challenge.js';
import { Reminders } from '../core/reminders.js';
import { processInChunks } from '@hotandcold/shared/utils';

Devvit.addSchedulerJob({
  name: 'DAILY_GAME_DROP',
  onRun: async (_, context) => {
    const newChallenge = await new ChallengeService(context.redis).makeNewChallenge({ context });

    const usernames = await Reminders.getUsersOptedIntoReminders({
      redis: context.redis,
    });

    await processInChunks({
      items: usernames,
      chunkSize: 25,
      promiseGenerator: (username: string) =>
        context.reddit.sendPrivateMessage({
          subject: `HotAndCold: Time to play challenge #${newChallenge.challenge}!`,
          text: `The new challenge is up! Go to [this link](${newChallenge.postUrl}) to play!\n\nUnsubscribe from these messages any time by going to the challenge, tapping the three dots, and selecting "Unsubscribe".`,
          to: username,
        }),
      onSuccess: (_, username) => {
        console.log(`Successfully sent message to ${username}.`);
      },
      onError: async (error, username) => {
        const err = error as Error;
        if (
          err.message.includes('INVALID_USER') ||
          err.message.includes('NO_USER') ||
          err.message.includes('NOT_WHITELISTED_BY_USER_MESSAGE')
        ) {
          try {
            console.log(
              `Removing user "${username}" from reminder list due to error: ${err.message}`
            );

            await Reminders.removeReminderForUsername({
              redis: context.redis,
              username,
            });
          } catch (removeError) {
            console.error(`Failed to remove user from reminder list: ${String(removeError)}`);
          }
        } else {
          console.error(`Failed to send message to ${username}: ${JSON.stringify(error)}`);
        }
      },
    });
  },
});

export const initialize = async (context: TriggerContext) => {
  // Certain things need to be initialized in Redis to run correctly
  await new WordListService(context.redis).initialize({ context });
  await new ChallengeService(context.redis).initialize({ context });

  const jobs = await context.scheduler.listJobs();
  for (const job of jobs) {
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
