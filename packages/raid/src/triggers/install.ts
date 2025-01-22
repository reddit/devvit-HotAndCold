import { Devvit, TriggerContext } from '@devvit/public-api';
import { WordList } from '../core/wordList.js';
import { Challenge } from '../core/challenge.js';
import { Reminders } from '../core/reminders.js';
import { processInChunks } from '@hotandcold/shared/utils';

Devvit.addSchedulerJob({
  name: 'DAILY_GAME_DROP',
  onRun: async (_, context) => {
    const newChallenge = await Challenge.makeNewChallenge({ context });

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
      onSuccess: async (result: any, username: string, index: number, chunkIndex: number) => {
        console.log(`Successfully sent message to ${username}.`);
      },
      onError: async (error: any, username: string, index: number, chunkIndex: number) => {
        if (
          error.message.includes('INVALID_USER') ||
          error.message.includes('NO_USER') ||
          error.message.includes('NOT_WHITELISTED_BY_USER_MESSAGE')
        ) {
          try {
            console.log(
              `Removing user "${username}" from reminder list due to error: ${error.message}`
            );

            await Reminders.removeReminderForUsername({
              redis: context.redis,
              username,
            });
          } catch (removeError) {
            console.error(`Failed to remove user from reminder list: ${removeError}`);
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

  await context.scheduler.runJob({
    // Every minute
    cron: '* * * * *',
    name: 'FAUCET_REFRESH_ALL_ACTIVE_CHALLENGES',
    data: {},
  });
};

Devvit.addTrigger({
  events: ['AppInstall'],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
