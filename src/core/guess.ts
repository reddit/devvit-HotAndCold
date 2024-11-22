import { z } from "zod";
import {
  zodContext,
  zoddy,
  zodRedditUsername,
  zodRedis,
  zodTransaction,
} from "../utils/zoddy.js";
import { Challenge } from "./challenge.js";
import { API } from "./api.js";
import { Streaks } from "./streaks.js";
import { ChallengeLeaderboard } from "./challengeLeaderboard.js";
import { Score } from "./score.js";
import { isEmptyObject, omit } from "../utils/utils.js";
import { GameResponse } from "../../game/shared.js";
import { Similarity } from "./similarity.js";
import { Players } from "./players.js";
import { ChallengeProgress } from "./challengeProgress.js";

export * as Guess from "./guess.js";

export const getChallengeUserKey = (
  challengeNumber: number,
  username: string,
) => `${Challenge.getChallengeKey(challengeNumber)}:user:${username}` as const;

export const guessSchema = z.object({
  word: z.string(),
  similarity: z.number().gte(-1).lte(1),
  normalizedSimilarity: z.number().gte(0).lte(100),
  timestamp: z.number(),
  // Only for top 1,000 similar words
  rank: z.number().gte(-1),
  isHint: z.boolean(),
});

const challengeUserInfoSchema = z.object({
  finalScore: z.number().optional(),
  startedPlayingAtMs: z.number().optional(),
  solvedAtMs: z.number().optional(),
  gaveUpAtMs: z.number().optional(),
  guesses: z.array(guessSchema).optional(),
});

export const getChallengeUserInfo = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(
      getChallengeUserKey(challenge, username),
    );

    if (!result) {
      throw new Error(`No user found for ${username} on day ${challenge}`);
    }

    return challengeUserInfoSchema.parse({
      finalScore: result.finalScore
        ? parseInt(result.finalScore, 10)
        : undefined,
      startedPlayingAtMs: result.startedPlayingAtMs
        ? parseInt(result.startedPlayingAtMs, 10)
        : undefined,
      solvedAtMs: result.solvedAtMs
        ? parseInt(result.solvedAtMs, 10)
        : undefined,
      gaveUpAtMs: result.gaveUpAtMs
        ? parseInt(result.gaveUpAtMs, 10)
        : undefined,
      guesses: JSON.parse(result.guesses ?? "[]"),
    });
  },
);

const maybeInitForUser = zoddy(
  z.object({
    redis: zodRedis,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    const result = await redis.hGetAll(
      getChallengeUserKey(challenge, username),
    );

    if (!result || isEmptyObject(result)) {
      await redis.hSet(
        getChallengeUserKey(challenge, username),
        {
          finalScore: "0",
          guesses: "[]",
          // These will be set as dates!
          solvedAtMs: "",
          gaveUpAtMs: "",
          startedPlayingAtMs: "",
        } satisfies Record<keyof z.infer<typeof challengeUserInfoSchema>, any>,
      );
    }
  },
);

export const markChallengeSolvedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
    completedAt: z.number(),
    finalScore: z.number(),
  }),
  async ({ redis, username, challenge, completedAt, finalScore }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      solvedAtMs: completedAt.toString(),
      finalScore: finalScore.toString(),
    });
  },
);

export const markChallengePlayedForUser = zoddy(
  z.object({
    redis: z.union([zodRedis, zodTransaction]),
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ redis, username, challenge }) => {
    await redis.hSet(getChallengeUserKey(challenge, username), {
      startedPlayingAtMs: Date.now().toString(),
    });
  },
);

export const getHintForUser = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ context, username, challenge }): Promise<GameResponse> => {
    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });
    const wordConfig = await API.getWordConfigCached({
      context,
      word: challengeInfo.word,
    });
    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    const givenSet = new Set(
      challengeUserInfo.guesses?.map((x) => x.word) ?? [],
    );

    // Filter to hints and hints that have already been given
    const remainingHints = wordConfig.similar_words.filter((entry) =>
      entry.is_hint && !givenSet.has(entry.word)
    );

    if (remainingHints.length === 0) {
      throw new Error(`I don't have any more hints for you. Give up?`);
    }

    // Get random index
    const randomIndex = Math.floor(Math.random() * remainingHints.length);
    const newHint = remainingHints[randomIndex];

    const hintToAdd: z.infer<typeof guessSchema> = {
      word: newHint.word,
      timestamp: Date.now(),
      similarity: newHint.similarity,
      normalizedSimilarity: Similarity.normalizeSimilarity({
        closestWordSimilarity: wordConfig.closest_similarity,
        furthestWordSimilarity: wordConfig.furthest_similarity,
        targetWordSimilarity: newHint.similarity,
      }),
      rank: wordConfig.similar_words.findIndex((x) => x.word === newHint.word),
      isHint: true,
    };

    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    await Challenge.incrementChallengeTotalHints({ redis: txn, challenge });

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify([...challengeUserInfo.guesses ?? [], hintToAdd]),
    });

    await ChallengeProgress.upsertEntry({
      redis: txn,
      challenge,
      username,
      progress: Math.max(
        hintToAdd.normalizedSimilarity,
        ...challengeUserInfo.guesses?.map((x) => x.normalizedSimilarity) ?? [],
      ),
    });

    // await txn.exec();

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      redis: context.redis,
      sort: "DESC",
      start: 0,
      stop: 10_000,
      username,
    });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: [...challengeUserInfo.guesses ?? [], hintToAdd],
      },
      challengeInfo: {
        ...omit(challengeInfo, ["word"]),
        totalHints: (challengeInfo.totalHints ?? 0) + 1,
      },
      challengeProgress,
    };
  },
);

export const submitGuess = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    avatar: z.string().nullable(),
    challenge: z.number().gt(0),
    guess: z.string().trim().toLowerCase(),
  }),
  async (
    { context, username, challenge, guess: rawGuess, avatar },
  ): Promise<GameResponse> => {
    await maybeInitForUser({ redis: context.redis, username, challenge });

    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    // Empty string check since we initially set it! Added other falsies just in case
    let startedPlayingAtMs = challengeUserInfo.startedPlayingAtMs;
    if (!challengeUserInfo.startedPlayingAtMs) {
      startedPlayingAtMs = Date.now();
      await Players.setPlayer({
        redis: txn,
        username,
        avatar,
      });
      await Challenge.incrementChallengeTotalPlayers({ redis: txn, challenge });
      await markChallengePlayedForUser({ challenge, redis: txn, username });
    }

    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }

    const distance = await API.compareWordsCached({
      context,
      secretWord: challengeInfo.word,
      guessWord: rawGuess,
    });

    console.log(`Username: ${username}:`, "distance", distance);

    if (
      challengeUserInfo.guesses && challengeUserInfo.guesses.length > 0 &&
      challengeUserInfo.guesses.find((x) => x.word === distance.wordBLemma)
    ) {
      throw new Error(`You've already guessed ${distance.wordBLemma}.`);
    }

    if (distance.similarity == null) {
      throw new Error(`Sorry, I'm not familiar with that word.`);
    }

    const wordConfig = await API.getWordConfigCached({
      context,
      word: challengeInfo.word,
    });

    console.log(`Username: ${username}:`, "word config", wordConfig);

    await Challenge.incrementChallengeTotalGuesses({ redis: txn, challenge });

    console.log(`Username: ${username}:`, "increment total guess complete");

    let rankOfWord: number | undefined = undefined;
    const indexOfGuess = wordConfig.similar_words.findIndex((x) =>
      x.word === distance.wordBLemma
    );
    if (indexOfGuess === -1) {
      // The word was found!
      if (distance.similarity === 1) {
        rankOfWord = 0;
      }

      // If the word is in the most similar words, rank it -1 meaning
      // it's not close!
      rankOfWord = -1;
    } else {
      // Plus one because similar words does not have the target word
      // So the closest you can ever guess is the 1st closest word
      rankOfWord = indexOfGuess + 1;
    }

    const guessToAdd: z.infer<typeof guessSchema> = {
      word: distance.wordBLemma,
      timestamp: Date.now(),
      similarity: distance.similarity,
      normalizedSimilarity: Similarity.normalizeSimilarity({
        closestWordSimilarity: wordConfig.closest_similarity,
        furthestWordSimilarity: wordConfig.furthest_similarity,
        targetWordSimilarity: distance.similarity,
      }),
      rank: rankOfWord,
      isHint: false,
    };

    const newGuesses = [...challengeUserInfo.guesses ?? [], guessToAdd];

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    const hasSolved = distance.similarity === 1;
    let score: number | undefined = undefined;
    if (hasSolved) {
      console.log(`User ${username} solved challenge ${challenge}!`);
      if (!startedPlayingAtMs) {
        throw new Error(
          `User ${username} has not started playing yet but solved?`,
        );
      }
      const completedAt = Date.now();
      const solveTimeMs = completedAt - startedPlayingAtMs;
      console.log("Calculating score...");
      score = Score.calculateScore({
        solveTimeMs,
        // Need to manually add guess here since this runs in a transaction
        // and the guess has not been added to the user's guesses yet
        guesses: newGuesses,
        totalHints: challengeUserInfo.guesses?.filter((x) =>
          x.isHint
        )?.length ?? 0,
      });

      console.log(`Score for user ${username} is ${score}`);

      console.log(`Marking challenge as solved for user ${username}`);

      await markChallengeSolvedForUser({
        challenge,
        redis: txn,
        username,
        completedAt,
        finalScore: score,
      });

      console.log(`Incrementing streak for user ${username}`);

      await Streaks.incrementEntry({ redis: txn, username });

      console.log(`Incrementing total solves for challenge ${challenge}`);

      await Challenge.incrementChallengeTotalSolves({ redis: txn, challenge });

      console.log(`Adding entry to leaderboard for user ${username}`);

      await ChallengeLeaderboard.addEntry({
        redis: txn,
        challenge,
        username,
        score,
        timeToCompleteMs: solveTimeMs,
      });

      console.log(`End of winning logic for user ${username}`);
    }

    await ChallengeProgress.upsertEntry({
      redis: txn,
      challenge,
      username,
      progress: Math.max(
        guessToAdd.normalizedSimilarity,
        ...challengeUserInfo.guesses?.map((x) => x.normalizedSimilarity) ?? [],
      ),
    });

    // await txn.exec();

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      redis: context.redis,
      sort: "DESC",
      start: 0,
      stop: 10_000,
      username,
    });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        guesses: newGuesses,
        solvedAtMs: hasSolved ? Date.now() : undefined,
        finalScore: score,
      },
      challengeInfo: {
        ...omit(challengeInfo, ["word"]),
        totalGuesses: (challengeInfo.totalGuesses ?? 0) + 1,
        totalPlayers: (challengeInfo.totalPlayers ?? 0) + 1,
        totalSolves: hasSolved ? (challengeInfo.totalSolves ?? 0) + 1 : 0,
      },
      challengeProgress,
    };
  },
);

export const giveUp = zoddy(
  z.object({
    context: zodContext,
    username: zodRedditUsername,
    challenge: z.number().gt(0),
  }),
  async ({ context, username, challenge }): Promise<GameResponse> => {
    // TODO: Transactions are broken
    // const txn = await context.redis.watch();
    // await txn.multi();
    const txn = context.redis;

    const challengeUserInfo = await getChallengeUserInfo({
      redis: context.redis,
      username,
      challenge,
    });

    if (challengeUserInfo.startedPlayingAtMs == null) {
      throw new Error(`User ${username} has not started playing yet`);
    }

    const challengeInfo = await Challenge.getChallenge({
      redis: context.redis,
      challenge,
    });

    if (!challengeInfo) {
      throw new Error(`Challenge ${challenge} not found`);
    }

    await txn.hSet(getChallengeUserKey(challenge, username), {
      gaveUpAtMs: Date.now().toString(),
    });

    const guessToAdd: z.infer<typeof guessSchema> = {
      word: challengeInfo.word,
      timestamp: Date.now(),
      similarity: 1,
      normalizedSimilarity: 100,
      rank: 0,
      isHint: true,
    };

    const newGuesses = [...challengeUserInfo.guesses ?? [], guessToAdd];

    await txn.hSet(getChallengeUserKey(challenge, username), {
      guesses: JSON.stringify(newGuesses),
    });

    await Challenge.incrementChallengeTotalGiveUps({ redis: txn, challenge });

    await ChallengeProgress.upsertEntry({
      redis: txn,
      challenge,
      username,
      // Giving up doesn't count!
      progress: -1,
    });

    // await txn.exec();

    const challengeProgress = await ChallengeProgress.getPlayerProgress({
      challenge,
      redis: context.redis,
      sort: "DESC",
      start: 0,
      stop: 10_000,
      username,
    });

    return {
      number: challenge,
      challengeUserInfo: {
        ...challengeUserInfo,
        gaveUpAtMs: Date.now(),
      },
      challengeInfo: {
        ...omit(challengeInfo, ["word"]),
        totalGiveUps: (challengeInfo.totalGiveUps ?? 0) + 1,
      },
      challengeProgress,
    };
  },
);
