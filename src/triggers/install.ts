import { Devvit, TriggerContext } from "@devvit/public-api";
import { WordList } from "../core/wordList.js";
import { Challenge } from "../core/challenge.js";

Devvit.addSchedulerJob({
  name: "DAILY_CHALLENGE_DROP",
  onRun: async (_, context) => {
    await Challenge.makeNewChallenge({ context });
  },
});

export const initialize = async (context: TriggerContext) => {
  // Certain things need to be initialized in Redis to run correctly
  await WordList.initialize({ redis: context.redis });
  await Challenge.initialize({
    redis: context.redis,
  });

  let jobs = await context.scheduler.listJobs();
  for (let job of jobs) {
    await context.scheduler.cancelJob(job.id);
  }

  await context.scheduler.runJob({
    cron: "0 22 * * *",
    name: "DAILY_CHALLENGE_DROP",
    data: {},
  });
};

Devvit.addTrigger({
  events: ["AppInstall"],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
