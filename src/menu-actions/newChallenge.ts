import { Devvit } from "@devvit/public-api";
import { Challenge } from "../core/challenge.js";

Devvit.addMenuItem({
  label: "HotAndCold: New challenge",
  location: "subreddit",
  onPress: async (_event, context) => {
    try {
      console.log("Making new challenge...");
      const { postUrl } = await Challenge.makeNewChallenge({ context });

      context.ui.navigateTo(postUrl);
    } catch (error) {
      console.error(`Error making new challenge:`, error);
    }
  },
});
