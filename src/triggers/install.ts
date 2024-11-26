import { Devvit, TriggerContext } from "@devvit/public-api";
import { WordList } from "../core/wordList.js";
import { Challenge } from "../core/challenge.js";
import { Reminders } from "../core/reminders.js";

Devvit.addSchedulerJob({
  name: "DAILY_GAME_DROP",
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
          subject:
            `HotAndCold: Time to play challenge #${newChallenge.challenge}!`,
          text:
            `The new challenge is up! Go to [this link](${newChallenge.postUrl}) to play!`,
          to: username,
        })
      );

      // Wait for all promises in chunk to resolve
      await Promise.all(promises);
      console.log(
        `Sent ${chunk.length} messages to users out of ${usernames.length}.`,
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
    cron: "0 13 * * *",
    name: "DAILY_GAME_DROP",
    data: {},
  });
};

Devvit.addTrigger({
  events: ["AppInstall"],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
