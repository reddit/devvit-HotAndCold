import { Devvit } from "@devvit/public-api";
import { initialize } from "./install.js";

Devvit.addTrigger({
  events: ["AppUpgrade"],
  onEvent: async (_, context) => {
    await initialize(context);
  },
});
