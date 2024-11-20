import OpenAI from "openai";
import dotenv from "dotenv";
import { performance } from "node:perf_hooks";
import levenshtein from "fast-levenshtein"; // Add this line to import the Levenshtein library

dotenv.config();

// Type definitions
type Vector = number[];
type WordEmbeddings = {
  [word: string]: Vector;
};

type WordSimilarity = {
  word: string;
  similarity: number;
};

type BenchmarkResult = {
  promptTemplate: string;
  similarities: WordSimilarity[];
  timeMs: number;
  averageSimilarity: number;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

async function getEmbedding(text: string): Promise<Vector> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      dimensions: 3072,
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error getting embedding:", error);
    throw error;
  }
}

function normalizeVector(v: Vector): Vector {
  const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
  return v.map((val) => val / norm);
}

function cosineSimilarity(v1: Vector, v2: Vector): number {
  if (v1.length !== v2.length) {
    throw new Error("Vectors must have the same length");
  }
  return v1.reduce((sum, val, i) => sum + val * v2[i], 0);
}

// New function to compute normalized Levenshtein distance
function normalizedLevenshteinDistance(word1: string, word2: string): number {
  const maxLength = Math.max(word1.length, word2.length);
  if (maxLength === 0) return 0;
  const distance = levenshtein.get(word1, word2);
  return distance / maxLength;
}

// Updated function to compute adjusted similarity
function adjustedSimilarity(
  embedding1: Vector,
  embedding2: Vector,
  word1: string,
  word2: string,
  alpha: number = 0.5,
): number {
  const embSim = cosineSimilarity(embedding1, embedding2);
  const charSim = 1 - normalizedLevenshteinDistance(word1, word2);
  return embSim - alpha * charSim;
}

async function generateRootWordSimilarities(
  rootWord: string,
  comparisonWords: string[],
  promptTemplate: string,
  batchSize: number = 50,
  useAdjustedSimilarity: boolean = false, // New parameter to toggle adjusted similarity
  alpha: number = 0.5, // New parameter to set the weight of character similarity
): Promise<WordSimilarity[]> {
  const embeddings: WordEmbeddings = {};

  // Get root word embedding first
  const rootPrompt = promptTemplate.replace("{word}", rootWord);
  embeddings[rootWord] = normalizeVector(await getEmbedding(rootPrompt));

  // Get embeddings for comparison words in batches
  for (let i = 0; i < comparisonWords.length; i += batchSize) {
    const batch = comparisonWords.slice(i, i + batchSize);
    const batchPromises = batch.map(async (word) => {
      const prompt = promptTemplate.replace("{word}", word);
      embeddings[word] = normalizeVector(await getEmbedding(prompt));
    });
    await Promise.all(batchPromises);
    console.log(
      `Processed ${
        Math.min(i + batchSize, comparisonWords.length)
      }/${comparisonWords.length} words for template: "${promptTemplate}"`,
    );
  }

  // Calculate similarities with root word
  const similarities: WordSimilarity[] = comparisonWords.map((word) => {
    let similarity: number;
    if (useAdjustedSimilarity) {
      // Use adjusted similarity
      similarity = adjustedSimilarity(
        embeddings[rootWord],
        embeddings[word],
        rootWord,
        word,
        alpha,
      );
    } else {
      // Use regular cosine similarity
      similarity = cosineSimilarity(embeddings[rootWord], embeddings[word]);
    }
    return { word, similarity };
  });

  // Sort by similarity (highest to lowest)
  return similarities.sort((a, b) => b.similarity - a.similarity);
}

async function benchmarkPromptTemplates({
  rootWord,
  comparisonWords,
  promptTemplates,
  batchSize = 50,
  useAdjustedSimilarity = false, // New parameter to toggle adjusted similarity
  alpha = 0.5, // New parameter to set the weight of character similarity
}: {
  rootWord: string;
  comparisonWords: string[];
  promptTemplates: string[];
  batchSize?: number;
  useAdjustedSimilarity?: boolean; // Updated
  alpha?: number; // Updated
}): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const template of promptTemplates) {
    const startTime = performance.now();

    const similarities = await generateRootWordSimilarities(
      rootWord,
      comparisonWords,
      template,
      batchSize,
      useAdjustedSimilarity, // Pass the parameter
      alpha, // Pass the alpha value
    );

    const averageSimilarity = similarities.reduce((sum, { similarity }) =>
      sum + similarity, 0) /
      similarities.length;

    results.push({
      promptTemplate: template,
      similarities,
      timeMs: performance.now() - startTime,
      averageSimilarity,
    });
  }

  return results;
}

async function main() {
  const rootWord = "banana"; // The word we're comparing everything against
  const comparisonWords = [
    "banana",
    "monkey",
    "food",
    "eat",
    "shoe",
    "particle",
    "ship",
    "book",
    "brave",
    "lion",
    "ban",
    "car",
    "cart",
    "dog",
    "melon",
    "bean",
    "breadfruit",
    "ananas",
    "plantain",
    "guanabana",
    "bloodberry",
    "beanball",
    "bane",
  ];

  const promptTemplates = [
    "{word}",
    `"{word}"`,
    "The complete word '{word}' has these exact boundaries: b>{word}<a",
    "The complete word '{word}' has these exact boundaries: b>{word}<a. Associations?",
    "Let X = '{word}'; Let Y = '{word}'; X === Y; This word means...",
    "Let W = '{word}'. Analyze the concept of W.",
    "Define variable W as '{word}'. What does W represent?",
    "The full meaning of {word}, not any partial matches",
    "Related to: {word}",
    "Word association: {word}",
    'The meaning of "{word}" is...',
  ];

  try {
    const useAdjustedSimilarity = false; // Set this to true or false to toggle the feature
    const alpha = 0.8; // Adjust the weight of character similarity (0 to 1)

    const results = await benchmarkPromptTemplates({
      rootWord,
      comparisonWords,
      promptTemplates,
      batchSize: 50,
      useAdjustedSimilarity, // Pass the parameter
      alpha, // Pass the alpha value
    });

    // Print results
    console.log(`\nSimilarity Rankings (comparing against "${rootWord}"):`);
    console.log("===============================================");

    results.forEach(
      ({ promptTemplate, similarities, timeMs, averageSimilarity }) => {
        console.log(`\nPrompt Template: "${promptTemplate}"`);
        console.log(`Time: ${timeMs.toFixed(2)}ms`);
        console.log(`Average Similarity: ${averageSimilarity.toFixed(4)}`);
        console.log("\nWords ranked by similarity:");
        similarities.forEach(({ word, similarity }) => {
          const similarityBar = "█".repeat(
            Math.floor((similarity + 1) * 25), // Adjusted for possible negative values
          );
          console.log(
            `${word.padEnd(12)}: ${similarity.toFixed(4)} ${similarityBar}`,
          );
        });
        console.log("-".repeat(50));
      },
    );

    // Find template that best differentiates words (lowest average similarity)
    const bestTemplate = results.reduce((a, b) =>
      a.averageSimilarity < b.averageSimilarity ? a : b
    );

    console.log("\nBest Differentiating Template:");
    console.log(
      `"${bestTemplate.promptTemplate}" with average similarity of ${
        bestTemplate.averageSimilarity.toFixed(
          4,
        )
      }`,
    );
  } catch (error) {
    console.error("Error in benchmark:", error);
  }
}

main().catch(console.error);
