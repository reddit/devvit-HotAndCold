import { z } from "zod";
import { zoddy, zodRedis } from "../utils/zoddy.js";
import { DEFAULT_WORD_LIST } from "../constants.js";

export * as WordList from "./wordList.js";

/**
 * NOTE: Word lists a mutable! There is no way to know what the original word list was.
 *
 * You can use ChallengeToWord.getAllUsedWords to get all the words that have been used in challenges
 * if you really need to pull this.
 */

// Adding default just in case we want to add more dictionaries in the future
export const getWordListKey = (dictionary = "default") =>
  `word_list:${dictionary}` as const;

export const getCurrentWordList = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const wordList = await redis.get(getWordListKey());

    if (!wordList) {
      throw new Error("No word list found");
    }

    return JSON.parse(wordList);
  },
);

export const setCurrentWordListWords = zoddy(
  z.object({
    redis: zodRedis,
    words: z.array(z.string().trim().toLowerCase()),
  }),
  async ({ redis, words }) => {
    await redis.set(getWordListKey(), JSON.stringify(words));
  },
);

export const initialize = zoddy(
  z.object({
    redis: zodRedis,
  }),
  async ({ redis }) => {
    const wordList = await redis.get(getWordListKey());
    if (!wordList) {
      await redis.set(getWordListKey(), JSON.stringify(DEFAULT_WORD_LIST));
    } else {
      console.log("Word list already exists. Skipping initialization.");
    }
  },
);

/**
 * Use if you want to add the next word that will be chosen.
 */
export const addToCurrentWordList = zoddy(
  z.object({
    redis: zodRedis,
    words: z.array(z.string().trim().toLowerCase()),
    /** Prepend means the words will be used before words already in the list */
    mode: z.enum(["prepend", "append"]).default("append"),
  }),
  async ({ redis, words, mode }) => {
    const wordList = await getCurrentWordList({ redis });

    // Filter out words that already exist
    const newWords = words.filter((word) => !wordList.includes(word));

    if (newWords.length === 0) {
      console.log("All words already in list. Nothing to add.");
      return {
        wordsAdded: 0,
        wordsSkipped: words.length,
      };
    }

    // Log skipped words
    const skippedWords = words.filter((word) => wordList.includes(word));
    if (skippedWords.length > 0) {
      console.log(`Skipping existing words: ${skippedWords.join(", ")}`);
    }

    await redis.set(
      getWordListKey(),
      JSON.stringify(
        mode === "prepend"
          ? [...newWords, ...wordList]
          : [...wordList, ...newWords],
      ),
    );

    return {
      wordsAdded: newWords.length,
      wordsSkipped: skippedWords.length,
    };
  },
);
