// @ts-expect-error
import lemmatize from "wink-lemmatizer";
import fs from "fs";
import * as csv from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = {
  inputPath: join(__dirname, "../words/output/wordnet.csv"),
  hintPath: join(__dirname, "../words/output/hintsList.csv"),
  outputPath: join(__dirname, "../words/output/finalizedWordList.csv"),
  rejectedWordsPath: join(__dirname, "../words/output/rejectedWords.csv"),
  filterOptions: {
    removeProfanity: true,
    removeNumbers: true,
    removeWordsContainingSpecialCharacters: true,
    removeMultipleWords: true,
    removeAbbreviations: true,
    processHyphenatedWords: true,
  },
  duplicateFields: ["synset_offset", "pos", "definition"],
  outputColumns: [
    "word",
    "synset_offset",
    "pos",
    "synset_type",
    "words_in_synset",
    "synonyms",
    "definition",
    "sense_count",
    "tag_sense_count",
    "hint",
  ],
} as const;

interface WordEntry {
  /** The actual word or term */
  word: string;

  /**
   * Unique identifier for the synset (set of synonyms)
   * Format: 8-digit number
   */
  synset_offset: string;

  /**
   * Part of speech marker
   * 'n' = noun
   * 'v' = verb
   * 'a' = adjective
   * 'r' = adverb
   * 's' = adjective satellite
   */
  pos: string;

  /**
   * The type of synset this word belongs to
   * Examples: noun.location, verb.motion, adj.all
   */
  synset_type: string;

  /** Number of words in this synset */
  words_in_synset: string;

  /**
   * List of synonyms in the synset
   * Format: semicolon-separated list
   */
  synonyms: string;

  /** The dictionary definition or gloss of the word */
  definition: string;

  /**
   * Number of senses this word has in WordNet
   * Higher numbers indicate more polysemous words
   */
  sense_count: string;

  /**
   * Frequency of this sense in semantic concordance texts
   * Higher numbers indicate more commonly used senses
   */
  tag_sense_count: string;
}

interface HintEntry {
  word: string;
  frequency: number;
}

interface RejectedWord {
  word: string;
  reason: string;
}

export interface ProcessedEntry extends WordEntry {
  originalWords?: string[];
  lemmatizedForm?: string;
  relatedEntries?: Partial<WordEntry>[];
  hint?: "0" | "1";
}

function isNumber(word: string): boolean {
  // Check if word contains any digits
  return /\d/.test(word);
}

const profanityList = new Set([
  "anal",
  "anus",
  "arse",
  "ass",
  "balls",
  "bastard",
  "bitch",
  "blow",
  "boob",
  "breast",
  "butt",
  "clit",
  "clitoris",
  "cock",
  "coitus",
  "cunt",
  "damn",
  "dick",
  "dildo",
  "dyke",
  "enema",
  "erotic",
  "fag",
  "faggot",
  "fellatio",
  "fuck",
  "gay",
  "genital",
  "genitalia",
  "gook",
  "hell",
  "homo",
  "homosexual",
  "horny",
  "hymen",
  "incest",
  "intercourse",
  "jizz",
  "kike",
  "labia",
  "lesbian",
  "masochist",
  "masturbate",
  "masturbation",
  "mofo",
  "nazi",
  "negro",
  "nigger",
  "nipple",
  "nude",
  "nudity",
  "oral",
  "organ",
  "orgasm",
  "orgy",
  "penis",
  "penile",
  "phallus",
  "piss",
  "poon",
  "porn",
  "porno",
  "pornography",
  "prick",
  "prostitute",
  "prostitution",
  "pube",
  "pubic",
  "pussy",
  "queer",
  "rape",
  "rectal",
  "rectum",
  "retard",
  "sadist",
  "scrotum",
  "semen",
  "sex",
  "sexual",
  "sexuality",
  "shit",
  "skank",
  "slut",
  "smut",
  "sperm",
  "spic",
  "spunk",
  "testicle",
  "testicular",
  "tit",
  "twat",
  "vagina",
  "vaginal",
  "vulva",
  "vulvar",
  "wank",
  "whore",
  "wop",
]);

function isProfane(word: string): boolean {
  return profanityList.has(word.toLowerCase());
}

const hasNonLetters = (word: string) => {
  // Only allows letters and hyphens, will return true if there's anything else
  return /[^a-zA-Z-]/.test(word);
};

function isAbbreviation(word: string): boolean {
  // Check if word is all uppercase and at least 2 characters long
  return word.length >= 2 && word === word.toUpperCase() &&
    /^[A-Z]+$/.test(word);
}

function hasMultipleWords(word: string): boolean {
  // Check for spaces or multiple words, excluding hyphenated words
  return word.includes(" ");
}

/**
 * Keep in sync with /compares-words/index.ts
 */
const lemmatizeIt = (input: string) => {
  const word = input.trim().toLowerCase();
  // Early return if word is empty or not a string
  if (!word || typeof word !== "string") {
    return word;
  }

  // Exception list
  const exceptions = new Set([
    "pass",
    "rose",
    "buss",
    "discuss",
    "better",
    "best",
    "lay",
    "left",
    "worst",
    "",
  ]);
  if (exceptions.has(word)) return word;

  // Try adjective first since it's most likely to be different if it is an adjective
  const adj = lemmatize.adjective(word);
  if (word !== adj) {
    return adj;
  }

  // Try verb next as it's typically the next most common case
  const verb = lemmatize.verb(word);
  if (word !== verb) {
    return verb;
  }

  // Try noun last as many words default to being nouns
  const noun = lemmatize.noun(word);
  if (word !== noun) {
    return noun;
  }

  // If no lemmatization changed the word, return original
  return word;
};

function processHyphenatedWord(word: string, _pos: string): string | null {
  if (!word.includes("-")) return word;

  // Special handling for 're-' prefix
  if (word.startsWith("re-")) {
    // Remove hyphen and lemmatize the whole word
    const dehyphenated = word.replace("-", "");
    return dehyphenated;
  }

  // Filter out all other hyphenated words
  return null;
}

function loadHintData(): Set<string> {
  try {
    const hintData = fs.readFileSync(CONFIG.hintPath, "utf-8");
    const records = csv.parse(hintData, {
      columns: true,
      skip_empty_lines: true,
    }) as HintEntry[];
    return new Set(records.map((record) => record.word.toLowerCase()));
  } catch (error) {
    console.error("Error loading hint data:", error);
    return new Set();
  }
}

function processWord(
  entry: WordEntry,
  hintWords: Set<string>,
  rejectedWords: RejectedWord[],
): ProcessedEntry | null {
  const { word, pos } = entry;

  if (CONFIG.filterOptions.removeProfanity && isProfane(word)) {
    // rejectedWords.push({ word, reason: "is profane" });
    return null;
  }
  if (CONFIG.filterOptions.removeNumbers && isNumber(word)) {
    // rejectedWords.push({ word, reason: "is number" });
    return null;
  }
  if (
    CONFIG.filterOptions.removeWordsContainingSpecialCharacters &&
    hasNonLetters(word)
  ) {
    // rejectedWords.push({ word, reason: "has non-letters" });
    return null;
  }
  if (CONFIG.filterOptions.removeAbbreviations && isAbbreviation(word)) {
    // rejectedWords.push({ word, reason: "is abbreviation" });
    return null;
  }
  if (CONFIG.filterOptions.removeMultipleWords && hasMultipleWords(word)) {
    // rejectedWords.push({ word, reason: "has multiple words" });
    return null;
  }

  const processedWord = processHyphenatedWord(word, pos);
  if (processedWord === null) {
    rejectedWords.push({ word, reason: "hyphenated word filtered" });
    return null;
  }

  const lemmatizedWord = lemmatizeIt(processedWord);
  if (lemmatizedWord !== processedWord) {
    rejectedWords.push({
      word: processedWord,
      reason: "lemmatized form differs",
    });
    return null;
  }

  return {
    ...entry,
    word: processedWord,
    hint: hintWords.has(processedWord.toLowerCase()) ? "1" : "0",
  };
}

function combineDuplicates(entries: ProcessedEntry[]): ProcessedEntry[] {
  const wordMap = new Map<string, ProcessedEntry>();

  entries.forEach((entry) => {
    if (wordMap.has(entry.word)) {
      const existing = wordMap.get(entry.word)!;
      CONFIG.duplicateFields.forEach((field) => {
        existing[field] = [existing[field], entry[field]].join(";;; ");
      });
      existing.hint = entry.hint === "1" || existing.hint === "1" ? "1" : "0";
    } else {
      wordMap.set(entry.word, entry);
    }
  });

  return Array.from(wordMap.values());
}

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function processCSV(): Promise<void> {
  try {
    const hintWords = loadHintData();
    console.log(`Loaded ${hintWords.size} hint words`);

    const inputData = fs.readFileSync(CONFIG.inputPath, "utf-8");
    const records = csv.parse(inputData, {
      columns: true,
      skip_empty_lines: true,
    }) as WordEntry[];

    const totalInitialEntries = records.length;
    const rejectedWords: RejectedWord[] = [];

    const processedEntries = records
      .map((entry) => processWord(entry, hintWords, rejectedWords))
      .filter((entry): entry is ProcessedEntry => entry !== null);

    const combinedEntries = combineDuplicates(processedEntries);

    ensureDirectoryExists(CONFIG.outputPath);
    ensureDirectoryExists(CONFIG.rejectedWordsPath);

    const outputCsv = stringify(combinedEntries, {
      header: true,
      columns: CONFIG.outputColumns,
    });
    fs.writeFileSync(CONFIG.outputPath, outputCsv);

    const rejectedWordsCsv = stringify(rejectedWords, {
      header: true,
      columns: ["word", "reason"],
    });
    fs.writeFileSync(CONFIG.rejectedWordsPath, rejectedWordsCsv);

    const hintCount = combinedEntries.filter((entry) =>
      entry.hint === "1"
    ).length;

    console.log("\nWord Processing Statistics:");
    console.log(`Initial total entries: ${totalInitialEntries}`);
    console.log(`Entries after filtering: ${processedEntries.length}`);
    console.log(`Final unique entries: ${combinedEntries.length}`);
    console.log(`Entries marked as hints: ${hintCount}`);
    console.log(
      `\nRemoved ${
        totalInitialEntries - processedEntries.length
      } entries during filtering`,
    );
    console.log(
      `Combined ${
        processedEntries.length - combinedEntries.length
      } duplicate entries`,
    );
    console.log(`Rejected words written to: ${CONFIG.rejectedWordsPath}`);
  } catch (error) {
    console.error("Error processing CSV:", error);
    throw error;
  }
}

processCSV().catch(console.error);
