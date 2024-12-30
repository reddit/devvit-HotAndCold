import { z } from "zod";
import { getHeatForGuess } from "../utils/getHeat.js";
import { zodContext, zoddy } from "../utils/zoddy.js";
import { guessSchema } from "./guess.js";
import { sendMessageToWebview } from "../utils/utils.js";

export * as Feedback from "./feedback.js";

function sample<T>(array: T[]): T {
  if (!array || array.length === 0) {
    throw new Error("Array is empty");
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

export const sendMessage = zoddy(
  z.object({ context: zodContext, newGuesses: z.array(guessSchema) }),
  ({ context, newGuesses }) => {
    const sendFeedback = (feedback: string, extra = {}) => {
      return sendMessageToWebview(context, {
        type: "FEEDBACK",
        payload: {
          feedback,
          ...extra,
        },
      });
    };

    const latestGuess = newGuesses[newGuesses.length - 1];
    const guessesWithHeat = newGuesses.map((x) => ({
      ...x,
      heat: getHeatForGuess(x),
    }));

    const firstOfTargetHeatHelper = (target: "COLD" | "WARM" | "HOT") => {
      const sample = guessesWithHeat.slice(1);
      const lastGuess = sample[sample.length - 1];
      if (lastGuess.heat !== target) return false;
      return sample.filter((x) => x.heat === target).length === 1;
    };

    const heatStreakHelper = (target: "COLD" | "WARM" | "HOT") => {
      const sample = guessesWithHeat.reverse();
      let totalStreak = 0;
      for (const guess of sample) {
        if (guess.heat !== target) break;
        totalStreak++;
      }
      return totalStreak;
    };

    const isFirstColdGuess = firstOfTargetHeatHelper("COLD");
    const isFirstWarmGuess = firstOfTargetHeatHelper("WARM");
    const isFirstHotGuess = firstOfTargetHeatHelper("HOT");

    const coldStreakLength = heatStreakHelper("COLD");
    const hotStreakLength = heatStreakHelper("HOT");
    // If you guess hot, then it's still warm!
    const warmStreakLength = heatStreakHelper("WARM") + hotStreakLength;

    const totalHotGuesses =
      guessesWithHeat.filter((x) => x.heat === "HOT").length;
    const totalWarmGuesses =
      guessesWithHeat.filter((x) => x.heat === "WARM").length;
    const totalColdGuesses =
      guessesWithHeat.filter((x) => x.heat === "COLD").length;

    const totalGuesses = newGuesses.length;
    const totalHints = newGuesses.filter((x) => x.isHint).length;

    // Welcome messages
    if (totalGuesses === 1) {
      const welcomeMessages = [
        "👋 Welcome aboard! I'm your friendly word detective assistant. Let's crack this puzzle together!",
        "🎮 Hey there, word explorer! Ready to embark on a semantic adventure?",
        "🌟 Welcome to the game! Think of me as your personal cheerleader in this word-hunting journey.",
        "🎯 First guess incoming! I'll be here to guide you along this adventure",
      ];
      return sendFeedback(sample(welcomeMessages));
    }

    // First cold guess messages
    if (isFirstColdGuess) {
      const coldMessages = [
        "❄️ Brrr, that's pretty far from our target! But hey, now we know where NOT to look.",
        "🧊 Getting chilly in here! Let's warm things up with a different angle.",
        "❄️ That guess is on ice! Try thinking in a different direction.",
        "🌨️ Not quite the direction we're heading, but every guess helps narrow it down!",
      ];
      return sendFeedback(sample(coldMessages));
    }

    // First warm guess messages
    if (isFirstWarmGuess) {
      const warmMessages = [
        `🌡️ Getting warmer! '${latestGuess.word}' has something in common with our target...`,
        `🌅 Now we're cooking! Think about what makes '${latestGuess.word}' special.`,
        `🌤️ That's a warm guess! Consider different aspects of '${latestGuess.word}'.`,
        `🎯 You're onto something with '${latestGuess.word}'! What else shares its qualities?`,
      ];
      return sendFeedback(sample(warmMessages));
    }

    // First hot guess messages
    if (isFirstHotGuess) {
      const hotMessages = [
        "🔥 Now we're talking! You're in the right neighborhood!",
        "🚀 Blast off! That guess is seriously close to the target!",
        "⭐ That's what I'm talking about! You're getting really close now!",
        "🎯 Bulls-eye territory! Keep exploring this semantic space!",
      ];
      return sendFeedback(sample(hotMessages));
    }

    // Cold streak messages
    if (coldStreakLength === 5) {
      return sendFeedback(
        "🧭 Seems like we're wandering in the wrong direction. Want to try a different approach?",
        {
          action: { message: "Request hint", type: "HINT" },
        },
      );
    }

    if (coldStreakLength === 10) {
      return sendFeedback(
        "🆘 10 cold guesses in a row? No worries, everyone gets stuck sometimes! How about a hint?",
        {
          action: { message: "Request hint", type: "HINT" },
        },
      );
    }

    // Hot streak messages
    if (hotStreakLength === 3) {
      const streakMessages = [
        "🎯 Three hot guesses in a row! You're absolutely crushing it!",
        "🔥 Triple threat! You're really zeroing in on the target!",
        "⚡ You're on fire! Keep that momentum going!",
      ];
      return sendFeedback(sample(streakMessages));
    }

    // Milestone messages
    if (totalGuesses === 7) {
      const earlyEngagementMessages = [
        "💭 Pro tip: The comments section is where the real mind games happen! Keep an eye out for hints... or leave your own devious clues!",
        "🎭 Want to be sneaky? Drop a hint in the comments - true or misleading, that's your strategy to master!",
        "🌟 Part of the fun is in the comments! Leave a cryptic clue for others... or a clever decoy!",
      ];
      return sendFeedback(sample(earlyEngagementMessages));
    }

    if (totalGuesses === 10) {
      return sendFeedback(
        "💫 10 guesses in! If you're enjoying the game, consider giving it an upvote to help others discover it!",
      );
    }

    if (totalGuesses === 15 && totalHotGuesses === 0) {
      return sendFeedback(
        "🤔 Still hunting for that first hot guess? Perhaps a hint could help point you in the right direction?",
        {
          action: { message: "Request hint", type: "HINT" },
        },
      );
    }

    if (totalGuesses === 25 && totalHotGuesses >= 5) {
      return sendFeedback(
        "🎯 You've had quite a few hot guesses! Try combining aspects of those words to zero in on the target.",
      );
    }

    if (totalGuesses === 30) {
      const persistenceMessages = [
        "🔍 Still searching? Try checking the comments - sometimes other players leave helpful clues!",
        "💭 30 guesses in! Your persistence is admirable. The community might have some insights below!",
        "🌟 You're really committed! Have you checked if anyone left hints in the comments?",
      ];
      return sendFeedback(sample(persistenceMessages));
    }

    if (totalGuesses === 40 && totalHotGuesses === 0) {
      return sendFeedback(
        "🎯 40 guesses without getting hot? No shame in using a hint - even the best players do!",
        {
          action: { message: "Request hint", type: "HINT" },
        },
      );
    }

    // Special achievement messages
    if (totalGuesses === 100 && totalHints === 0) {
      return sendFeedback(
        "🏆 Wow! 100 guesses without a hint? That's impressive dedication! But you know I still have to offer...",
        {
          action: { message: "Request hint", type: "HINT" },
        },
      );
    }

    if (totalGuesses === 50 && totalHotGuesses >= 10) {
      return sendFeedback(
        "🎓 You've made lots of hot guesses! Try combining what they have in common!",
      );
    }

    // Endurance messages
    if (totalGuesses === 250) {
      return sendFeedback(
        "🏋️ 250 guesses? Now that's determination! Remember, there's no shame in tactical retreat.",
        {
          action: { type: "GIVE_UP", message: "Give up" },
        },
      );
    }

    if (totalGuesses === 1000) {
      return sendFeedback(
        "🦾 A thousand guesses?! Your persistence is legendary! But maybe it's time to live to fight another day?",
        {
          action: { type: "GIVE_UP", message: "Give up" },
        },
      );
    }

    // Social sharing prompts
    if (totalGuesses === 12 && Math.random() < 0.5) { // 50% chance to show early share prompt
      const sharingMessages = [
        "🤝 Stuck? Share with a friend! Sometimes two heads are better than one... plus it's more fun together!",
        "🎮 Know someone who's great with words? Share this with them - they might spot something you missed!",
        "🌟 This is even better with friends! Share it and turn it into a friendly competition!",
      ];
      return sendFeedback(sample(sharingMessages));
    }

    if (totalGuesses === 35 && totalHotGuesses === 0 && totalWarmGuesses < 5) {
      return sendFeedback(
        "🤔 Still hunting? Maybe a friend could help! Sometimes a fresh perspective makes all the difference!",
      );
    }

    if (coldStreakLength === 8 && totalGuesses < 25) {
      return sendFeedback(
        "🎯 Running out of ideas? Share with a friend! They might think of words you haven't considered.",
      );
    }

    if (warmStreakLength === 4 && totalGuesses < 30) {
      const competitiveMessages = [
        "🏆 You're doing great! Challenge a friend to beat your score!",
        "🎯 You've got skills! Know anyone who thinks they could do better?",
      ];
      return sendFeedback(sample(competitiveMessages));
    }

    if (totalHotGuesses >= 3 && totalGuesses < 40 && Math.random() < 0.3) { // 30% chance when doing well
      return sendFeedback(
        "⭐ You're crushing it! Share this with someone who loves a good word puzzle!",
      );
    }

    if (totalGuesses === 25 && totalHints === 0 && Math.random() < 0.4) { // 40% chance for persistent players
      return sendFeedback(
        "🧩 Enjoying the challenge? Tag a wordsmith friend who'd love this kind of puzzle!",
      );
    }

    // Comment conversation prompts
    if (totalGuesses === 28 && totalHotGuesses >= 2 && Math.random() < 0.3) {
      const discussionMessages = [
        "💬 Got a clever solving strategy? Drop it in the comments - wrong answers only!",
        "🎭 Time to join the mind games! Share your most misleading-but-technically-true hint below.",
      ];
      return sendFeedback(sample(discussionMessages));
    }

    if (coldStreakLength === 12 && Math.random() < 0.4) {
      return sendFeedback(
        "💭 Stuck in a rut? Check the comments - but watch out, some of those 'hints' are pure chaos!",
      );
    }

    if (totalGuesses === 60 && totalHotGuesses >= 5 && Math.random() < 0.3) {
      return sendFeedback(
        "👀 You've got some good guesses! Share your thought process below - or better yet, throw everyone off track!",
      );
    }

    // User feedback prompts
    if (totalGuesses === 18 && Math.random() < 0.4) { // 40% chance mid-game
      const feedbackMessages = [
        "💡 Got ideas to make this game even better? Drop your suggestions in the comments!",
        "🎮 What features would make this more fun? Share your thoughts below!",
        "✨ Help shape the game! What would you add or change? Let us know in the comments!",
      ];
      return sendFeedback(sample(feedbackMessages));
    }

    if (totalGuesses === 50 && totalHotGuesses >= 4 && Math.random() < 0.3) { // 30% chance for skilled players
      return sendFeedback(
        "🎯 You're clearly good at this! Any suggestions for making the game more challenging? Share below!",
      );
    }

    if (totalGuesses === 30 && totalHints >= 2) { // Players who needed hints
      return sendFeedback(
        "🤔 How could we make the hints more helpful? Drop your ideas in the comments!",
      );
    }

    if (totalGuesses === 75 && totalHotGuesses === 0 && Math.random() < 0.4) { // 40% chance for struggling players
      return sendFeedback(
        "💭 Finding it tricky? Let us know in the comments what would make the difficulty feel just right!",
      );
    }

    // Dad joke messages
    if (totalGuesses === 24 && Math.random() < 0.2) { // Low chance for dad jokes
      return sendFeedback(
        "🎭 Why did the dictionary feel sad? It lost all its words! (Unlike you - you've got plenty of guesses left!)",
      );
    }

    if (coldStreakLength === 7 && Math.random() < 0.2) {
      return sendFeedback(
        "❄️ What did the word say when it was stressed? 'I need to take things letter by letter!'",
      );
    }

    if (
      totalWarmGuesses === 5 && totalHotGuesses === 0 && Math.random() < 0.2
    ) {
      return sendFeedback(
        "📚 What did one thesaurus say to the other? Long time no synonym! (Speaking of synonyms...)",
      );
    }

    if (totalHints >= 3 && Math.random() < 0.2) {
      return sendFeedback(
        "🎯 What's a word puzzle's favorite snack? Hint chips! (Sorry, that was terrible. Back to guessing!)",
      );
    }

    if (warmStreakLength === 3 && Math.random() < 0.2) {
      return sendFeedback(
        "🌡️ What did the warm guess say to the cold guess? You need to chill! (But not too much...)",
      );
    }

    if (totalGuesses === 50 && Math.random() < 0.2) {
      return sendFeedback(
        "🎯 Why don't words like playing hide and seek? Because they always get caught in a sentence! (Keep searching!)",
      );
    }

    if (totalGuesses === 40 && Math.random() < 0.2) {
      return sendFeedback(
        "🎲 Why did the word quit its job? It didn't get enough letters of recommendation! (Unlike you - you're doing great!)",
      );
    }

    if (totalHints === 5 && Math.random() < 0.2) {
      return sendFeedback(
        "💡 What did one hint say to the other? You're not being very helpful! (But hopefully I am!)",
      );
    }

    // Fun personality messages
    if (
      hotStreakLength === 2 && coldStreakLength === 0 && Math.random() < 0.3
    ) {
      const hotRunMessages = [
        "🎯 Look at you go! Save some hot guesses for the rest of us!",
        "🔥 Someone's been practicing their word games...",
      ];
      return sendFeedback(sample(hotRunMessages));
    }

    if (coldStreakLength === 6 && totalGuesses < 20 && Math.random() < 0.4) {
      const freezingMessages = [
        "❄️ Time for a new strategy? This one's not exactly working out",
        "🧊 These guesses are ice cold. But hey, at least we know what it's not!",
      ];
      return sendFeedback(sample(freezingMessages));
    }

    if (totalGuesses === 37) {
      return sendFeedback(
        "🎰 Guess #37 - the most random of numbers. Sort of ironic, no?",
      );
    }

    if (totalGuesses === 42) {
      return sendFeedback(
        "✨ Guess #42 - traditionally a lucky number. Let's see if it works here!",
      );
    }

    if (warmStreakLength === 5 && Math.random() < 0.3) {
      return sendFeedback("👀 You're onto something... but what exactly?");
    }

    if (totalGuesses % 25 === 0 && totalGuesses > 50 && Math.random() < 0.3) {
      const persistenceMessages = [
        "💪 Most people would've given up by now. Not you though!",
        "🎯 Your dedication is impressive. Let's crack this!",
      ];
      return sendFeedback(sample(persistenceMessages));
    }

    if (totalHotGuesses === 7 && Math.random() < 0.4) {
      return sendFeedback(
        "🎲 Seven hot guesses! The luck is strong with this one.",
      );
    }

    if (totalGuesses === 13 && Math.random() < 0.3) {
      return sendFeedback("🎲 Unlucky 13? Not with these guesses!");
    }

    if (
      totalWarmGuesses === 10 && totalHotGuesses === 0 && Math.random() < 0.3
    ) {
      return sendFeedback(
        "🤔 You're circling the answer... but which direction to go?",
      );
    }

    if (totalGuesses === 99 && Math.random() < 0.5) {
      return sendFeedback(
        "💯 One more for the century mark! You're nothing if not persistent.",
      );
    }

    // if (totalHints === 0 && totalGuesses === 69 && Math.random() < 0.3) {
    //   return sendFeedback("😎 Nice.");
    // }

    if (totalGuesses === 15 && totalWarmGuesses >= 3 && Math.random() < 0.3) {
      return sendFeedback(
        "🎯 Getting warmer... or are you just really good at finding related words?",
      );
    }

    if (coldStreakLength === 4 && totalHotGuesses >= 1 && Math.random() < 0.4) {
      return sendFeedback(
        "👀 Remember that hot guess earlier? Maybe there's something there...",
      );
    }

    // Community engagement messages
    if (warmStreakLength === 5) {
      return sendFeedback(
        "🤔 You're consistently warm - try thinking about what these words have in common!",
      );
    }

    if (totalWarmGuesses >= 15 && totalHotGuesses === 0) {
      return sendFeedback(
        "💡 You've found lots of related words! Try to think about what connects all your warm guesses.",
      );
    }

    // Community engagement messages
    if (totalHotGuesses >= 2) {
      const communityMessages = [
        "🌟 Got it figured out? Leave a hint below! But remember, sometimes the best hint is a red herring...",
        "🎪 Join the mind games! Drop a hint in the comments - make it helpful or wonderfully misleading!",
      ];
      return sendFeedback(sample(communityMessages));
    }

    if (totalHotGuesses >= 5) {
      const communityMessages = [
        "😈 Know the answer? Leave a cryptic hint in the comments... or perhaps a clever misdirection?",
        "🎭 Time to play mind games! Drop a hint in the comments - true or false, that's your call...",
      ];
      return sendFeedback(sample(communityMessages));
    }

    if (totalGuesses === 45) {
      return sendFeedback(
        "🎪 Stuck? Check the comments... but beware, not every hint is what it seems!",
      );
    }

    // Default case - empty feedback to acknowledge the guess
    return sendFeedback("");
  },
);
