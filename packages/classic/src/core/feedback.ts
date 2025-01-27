import { getHeatForGuess } from '@hotandcold/shared/utils';
import { zodContext, zoddy } from '@hotandcold/shared/utils/zoddy';
import { z } from 'zod';
import { guessSchema } from '../utils/guessSchema.js';
import { sendMessageToWebview } from '../utils/index.js';

export * as Feedback from './feedback.js';

function sample<T>(array: T[]): T {
  if (!array || array.length === 0) {
    throw new Error('Array is empty');
  }
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

const heatSchema = z.enum(['COLD', 'WARM', 'HOT']);

export const firstOfTargetHeatHelper = zoddy(
  z.object({
    guesses: z.array(guessSchema.extend({ heat: heatSchema })),
    target: heatSchema,
  }),
  ({ guesses, target }) => {
    // We have a welcome message that doesn't "count"
    if (guesses.length === 1) return false;

    // The first guess doesn't "count" because we have a welcome message
    // The last message is what we're testing
    const sample = guesses.slice(1, -1);
    const isGuessInSample = sample.filter((x) => x.heat === target).length > 0;

    if (isGuessInSample) return false;

    const lastGuess = guesses[guesses.length - 1];
    if (!lastGuess) return false;

    // Filter hints because they don't count!
    return lastGuess.heat === target;
  }
);

export const heatStreakHelper = zoddy(
  z.object({
    guesses: z.array(guessSchema.extend({ heat: heatSchema })),
    target: heatSchema,
  }),
  ({ guesses, target }) => {
    const sample = guesses.reverse();
    let totalStreak = 0;
    for (const guess of sample) {
      if (guess.heat !== target) break;
      totalStreak++;
    }
    return totalStreak;
  }
);

export const sendMessage = zoddy(
  z.object({ context: zodContext, newGuesses: z.array(guessSchema) }),
  ({ context, newGuesses }) => {
    const sendFeedback = (feedback: string, extra = {}) => {
      return sendMessageToWebview(context, {
        type: 'FEEDBACK',
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

    const isFirstColdGuess = firstOfTargetHeatHelper({ guesses: guessesWithHeat, target: 'COLD' });
    const isFirstWarmGuess = firstOfTargetHeatHelper({ guesses: guessesWithHeat, target: 'WARM' });
    const isFirstHotGuess = firstOfTargetHeatHelper({ guesses: guessesWithHeat, target: 'HOT' });

    const coldStreakLength = heatStreakHelper({ guesses: guessesWithHeat, target: 'COLD' });
    const hotStreakLength = heatStreakHelper({ guesses: guessesWithHeat, target: 'HOT' });
    // If you guess hot, then it's still warm!
    const warmStreakLength =
      heatStreakHelper({ guesses: guessesWithHeat, target: 'WARM' }) + hotStreakLength;

    const totalHotGuesses = guessesWithHeat.filter((x) => x.heat === 'HOT').length;
    const totalWarmGuesses = guessesWithHeat.filter((x) => x.heat === 'WARM').length;
    const totalColdGuesses = guessesWithHeat.filter((x) => x.heat === 'COLD').length;

    const totalGuesses = newGuesses.length;
    const totalHints = newGuesses.filter((x) => x.isHint).length;

    // Welcome messages
    if (totalGuesses === 1) {
      const welcomeMessages = [
        "👋 Welcome aboard! I'm your friendly word detective assistant. Let's crack this puzzle together!",
        '🎮 Hey there, word explorer! Ready to embark on a semantic adventure?',
        '🌟 Welcome to the game! Think of me as your personal cheerleader in this word-hunting journey.',
        "🎯 First guess incoming! I'll be here to guide you along this adventure",
      ];
      return sendFeedback(sample(welcomeMessages));
    }

    // First cold guess messages
    if (isFirstColdGuess) {
      const coldMessages = ["❄️ Brrr, that's pretty far from our target!"];
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
        '🚀 Blast off! That guess is seriously close to the target!',
        "⭐ That's what I'm talking about! You're getting really close now!",
        '🎯 Bulls-eye territory! Keep exploring this semantic space!',
      ];
      return sendFeedback(sample(hotMessages));
    }

    // Cold streak messages
    if (coldStreakLength === 11) {
      return sendFeedback("It's a little chilly in here. How about a hint?", {
        action: { message: 'Request hint', type: 'HINT' },
      });
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
    if (totalGuesses === 17) {
      const earlyEngagementMessages = [
        '💭 Keep an eye out for hints in the comments... or leave your own devious clues!',
        '🎭 Want to be sneaky? Drop a hint in the comments - true or misleading...',
        '🌟 The fun is in the comments! Leave a cryptic clue for others... or a clever decoy!',
      ];
      return sendFeedback(sample(earlyEngagementMessages));
    }

    if (totalGuesses === 10) {
      return sendFeedback(
        "💫 10 guesses in! If you're enjoying the game, consider giving it an upvote to help others discover it!"
      );
    }

    if (totalGuesses === 15 && totalHotGuesses === 0) {
      return sendFeedback(
        '🤔 Still hunting for that first hot guess? Perhaps a hint could help point you in the right direction?',
        {
          action: { message: 'Request hint', type: 'HINT' },
        }
      );
    }

    if (totalGuesses === 25 && totalHotGuesses >= 5) {
      return sendFeedback(
        "🎯 You've had quite a few hot guesses! Try combining aspects of those words to zero in on the target."
      );
    }

    if (totalGuesses === 30) {
      const persistenceMessages = [
        '🔍 Still searching? Try checking the comments - sometimes other players leave helpful clues!',
        '💭 30 guesses in! Your persistence is admirable. The community might have some insights below!',
        "🌟 You're really committed! Have you checked if anyone left hints in the comments?",
      ];
      return sendFeedback(sample(persistenceMessages));
    }

    if (totalGuesses === 40 && totalHotGuesses === 0) {
      return sendFeedback('🎯 No shame in using a hint!', {
        action: { message: 'Request hint', type: 'HINT' },
      });
    }

    // Special achievement messages
    if (totalGuesses === 100 && totalHints === 0) {
      return sendFeedback(
        "🏆 Wow! 100 guesses without a hint? That's impressive dedication! But you know I still have to offer...",
        {
          action: { message: 'Request hint', type: 'HINT' },
        }
      );
    }

    if (totalGuesses === 50 && totalHotGuesses >= 10) {
      return sendFeedback(
        "🎓 You've made lots of hot guesses! Try combining what they have in common!"
      );
    }

    // Endurance messages
    if (totalGuesses === 250) {
      return sendFeedback(
        "🏋️ 250 guesses? Now that's determination! Remember, there's no shame in tactical retreat.",
        {
          action: { type: 'GIVE_UP', message: 'Give up' },
        }
      );
    }

    if (totalGuesses === 1000) {
      return sendFeedback(
        "🦾 A thousand guesses?! Your persistence is legendary! But maybe it's time to live to fight another day?",
        {
          action: { type: 'GIVE_UP', message: 'Give up' },
        }
      );
    }

    // Social sharing prompts
    if (totalGuesses === 12 && Math.random() < 0.5) {
      // 50% chance to show early share prompt
      const sharingMessages = [
        "🤝 Stuck? Share with a friend! Sometimes two heads are better than one... plus it's more fun together!",
        "🎮 Know someone who's great with words? Share this with them - they might spot something you missed!",
        '🌟 This is even better with friends! Share it and turn it into a friendly competition!',
      ];
      return sendFeedback(sample(sharingMessages));
    }

    if (totalGuesses === 35 && totalHotGuesses === 0 && totalWarmGuesses < 5) {
      return sendFeedback(
        '🤔 Still hunting? Maybe a friend could help! Sometimes a fresh perspective makes all the difference!'
      );
    }

    if (coldStreakLength === 8 && totalGuesses < 25) {
      return sendFeedback(
        "🎯 Running out of ideas? Share with a friend! They might think of words you haven't considered."
      );
    }

    if (warmStreakLength === 4 && totalGuesses < 30) {
      const competitiveMessages = [
        "🏆 You're doing great! Challenge a friend to beat your score!",
        "🎯 You've got skills! Know anyone who thinks they could do better?",
      ];
      return sendFeedback(sample(competitiveMessages));
    }

    if (totalHotGuesses >= 3 && totalGuesses < 40 && Math.random() < 0.3) {
      // 30% chance when doing well
      return sendFeedback(
        "⭐ You're crushing it! Share this with someone who loves a good word puzzle!"
      );
    }

    if (totalGuesses === 25 && totalHints === 0 && Math.random() < 0.4) {
      // 40% chance for persistent players
      return sendFeedback(
        "🧩 Enjoying the challenge? Tag a wordsmith friend who'd love this kind of puzzle!"
      );
    }

    // Comment conversation prompts
    if (totalGuesses === 28 && totalHotGuesses >= 2 && Math.random() < 0.3) {
      const discussionMessages = [
        '💬 Got a clever solving strategy? Drop it in the comments - wrong answers only!',
        '🎭 Time to join the mind games! Share your most misleading-but-technically-true hint below.',
      ];
      return sendFeedback(sample(discussionMessages));
    }

    if (coldStreakLength === 12 && Math.random() < 0.4) {
      return sendFeedback('💭 Stuck in a rut? Check the comments!');
    }

    if (totalGuesses === 60 && totalHotGuesses >= 5 && Math.random() < 0.3) {
      return sendFeedback(
        "👀 You've got some good guesses! Share your thought process below - or better yet, throw everyone off track!"
      );
    }

    // User feedback prompts
    if (totalGuesses === 18 && Math.random() < 0.4) {
      // 40% chance mid-game
      const feedbackMessages = [
        '💡 Got ideas to make this game even better? Drop your suggestions in the comments!',
        '🎮 What features would make this more fun? Share your thoughts below!',
        '✨ Help shape the game! What would you add or change? Let us know in the comments!',
      ];
      return sendFeedback(sample(feedbackMessages));
    }

    if (totalGuesses === 50 && totalHotGuesses >= 4 && Math.random() < 0.3) {
      // 30% chance for skilled players
      return sendFeedback(
        "🎯 You're clearly good at this! Any suggestions for making the game more challenging? Share below!"
      );
    }

    if (totalGuesses === 30 && totalHints >= 2) {
      // Players who needed hints
      return sendFeedback(
        '🤔 How could we make the hints more helpful? Drop your ideas in the comments!'
      );
    }

    if (totalGuesses === 75 && totalHotGuesses === 0 && Math.random() < 0.4) {
      // 40% chance for struggling players
      return sendFeedback(
        '💭 Finding it tricky? Let us know in the comments what would make the difficulty feel just right!'
      );
    }

    // Dad joke messages
    if (totalGuesses === 20 && Math.random() < 0.2) {
      return sendFeedback(
        "📚 What did the passive verb say? I'd rather not be active right now! (Unlike you - keep those guesses coming!)"
      );
    }

    if (totalHotGuesses === 4 && Math.random() < 0.2) {
      return sendFeedback('🔥 Why did the hot guess go to the doctor? It had a high word count!');
    }

    if (warmStreakLength === 3 && Math.random() < 0.2) {
      return sendFeedback(
        '🌡️ What did the warm guess say to the cold guess? You need to chill! (But not too much...)'
      );
    }

    if (totalGuesses === 50 && Math.random() < 0.2) {
      return sendFeedback(
        "🎯 Why don't words like playing hide and seek? Because they always get caught in a sentence! (Keep searching!)"
      );
    }

    if (totalWarmGuesses === 8 && Math.random() < 0.2) {
      return sendFeedback(
        "📝 What's a synonym's favorite day? Thesaurus-day! (Get it? Thursday? I'll stop now...)"
      );
    }

    if (totalGuesses === 40 && Math.random() < 0.2) {
      return sendFeedback(
        "🎲 Why did the word quit its job? It didn't get enough letters of recommendation! (Unlike you - you're doing great!)"
      );
    }

    if (totalGuesses === 24 && Math.random() < 0.2) {
      return sendFeedback(
        "🎭 Why did the dictionary feel sad? It lost all its words! (Unlike you - you've got plenty of guesses left!)"
      );
    }

    // Devious comment prompts
    if (totalHotGuesses === 3 && totalGuesses < 20) {
      const tricksterMessages = [
        '😈 You seem clever... clever enough to leave a delightfully misleading hint in the comments?',
        '🎭 Masters of the game make the best tricksters! Care to leave a deceptive clue below?',
      ];
      return sendFeedback(sample(tricksterMessages));
    }

    if (warmStreakLength === 6) {
      return sendFeedback(
        '🎪 Six warm guesses in a row! You must know something... Share a cryptic hint that only LOOKS helpful!'
      );
    }

    if (totalGuesses === 22 && totalHotGuesses >= 1) {
      return sendFeedback('Nice, a hot guess! Drop a hint in the comments - but make it tricky!');
    }

    if (warmStreakLength === 8) {
      return sendFeedback("🌡️ Eight warm guesses in a row? You're not just warm, you're tropical!");
    }

    if (totalGuesses === 55 && totalHotGuesses === 0 && totalWarmGuesses >= 10) {
      return sendFeedback(
        "🎯 You're the master of 'almost there'! So many warm guesses... the secret word is sweating!"
      );
    }

    if (coldStreakLength === 15 && totalHints === 0) {
      return sendFeedback(
        '🧊 Fifteen cold guesses in a row without asking for hints? Your determination is absolutely legendary!'
      );
    }

    if (totalGuesses === 80 && totalHotGuesses >= 12) {
      return sendFeedback(
        "🔥 Twelve hot guesses? You're not just hot, you're supernova hot! The word can't hide much longer!"
      );
    }

    if (totalWarmGuesses === 20 && totalHotGuesses === 0) {
      return sendFeedback(
        "🌡️ Twenty warm guesses! You're the champion of 'close but no cigar' - time to turn up the heat!"
      );
    }

    if (totalGuesses % 50 === 0 && totalHints === 0 && totalGuesses > 100) {
      return sendFeedback(
        `💪 No hints after ${totalGuesses} guesses? You're either incredibly stubborn or incredibly brilliant... maybe both?`
      );
    }

    if (hotStreakLength === 5) {
      return sendFeedback(
        '🎯 Five hot guesses in a row! The target word is probably feeling very exposed right now!'
      );
    }

    // Fun personality messages
    if (hotStreakLength === 2 && coldStreakLength === 0 && Math.random() < 0.3) {
      const hotRunMessages = [
        '🎯 Look at you go! Save some hot guesses for the rest of us!',
        "🔥 Someone's been practicing their word games...",
      ];
      return sendFeedback(sample(hotRunMessages));
    }

    if (totalGuesses === 37) {
      return sendFeedback('🎰 Guess #37 - the most random of numbers. Sort of ironic, no?');
    }

    if (totalGuesses === 42) {
      return sendFeedback(
        "✨ Guess #42 - traditionally a lucky number. Let's see if it works here!"
      );
    }

    // Default case - empty feedback to acknowledge the guess
    return sendFeedback('');
  }
);
