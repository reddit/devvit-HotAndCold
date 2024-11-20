import {
  Devvit,
  MultiTriggerDefinition,
  TriggerContext,
} from "@devvit/public-api";
import { WordList } from "../core/wordList.js";
import { Challenge } from "../core/challenge.js";

Devvit.addSchedulerJob({
  name: "DAILY_GAME_DROP",
  onRun: async (_, context) => {
    await Challenge.makeNewChallenge({ context });
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
    cron: "0 22 * * *",
    name: "DAILY_GAME_DROP",
    data: {},
  });
};

type AppUpgrade = MultiTriggerDefinition<"AppUpgrade">["onEvent"];
const functionSomething: AppUpgrade = (e, context) => {
  console.log(e.installer, context.appName);
};

Devvit.addTrigger({
  events: ["AppUpgrade"],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
