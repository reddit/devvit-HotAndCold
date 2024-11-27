// @ts-expect-error
import lemmatize from "wink-lemmatizer";
import fs from "fs";
import * as csv from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import path, { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===================== CONFIGURATION =====================
const CONFIG = {
  inputPath: join(__dirname, "../words/output/wordnet.csv"),
  hintPath: join(__dirname, "../words/output/hintsList.csv"),
  outputPath: join(__dirname, "../words/output/finalizedWordList.csv"),
  filterOptions: {
    removeProfanity: true,
    removeNumbers: true,
    removeWordsContainingSpecialCharacters: true,
    removeMultipleWords: true,
    removeAbbreviations: true,
    processHyphenatedWords: true,
  },
  // Customize which fields to maintain when combining duplicates
  duplicateFields: ["synset_offset", "pos", "definition"],
  // Define which columns to keep in the output
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

// ===================== TYPES =====================
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
  const lowercaseWord = word.toLowerCase();
  return profanityList.has(lowercaseWord);
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

// ===================== MAIN PROCESSING FUNCTIONS =====================
function shouldFilterWord(word: string): boolean {
  if (CONFIG.filterOptions.removeProfanity && isProfane(word)) return true;
  if (CONFIG.filterOptions.removeNumbers && isNumber(word)) return true;
  if (
    CONFIG.filterOptions.removeWordsContainingSpecialCharacters &&
    hasNonLetters(word)
  ) return true;
  if (CONFIG.filterOptions.removeAbbreviations && isAbbreviation(word)) {
    return true;
  }
  if (CONFIG.filterOptions.removeMultipleWords && hasMultipleWords(word)) {
    return true;
  }
  return false;
}

// ===================== HINT PROCESSING =====================
function loadHintData(): Set<string> {
  try {
    const hintData = fs.readFileSync(CONFIG.hintPath, "utf-8");
    const records = csv.parse(hintData, {
      columns: true,
      skip_empty_lines: true,
    }) as HintEntry[];

    // Create a Set of words from hint data for efficient lookup
    return new Set(records.map((record) => record.word.toLowerCase()));
  } catch (error) {
    console.error("Error loading hint data:", error);
    return new Set();
  }
}

function processWord(
  entry: WordEntry,
  hintWords: Set<string>,
): ProcessedEntry | null {
  const { word, pos } = entry;

  if (shouldFilterWord(word)) {
    return null;
  }

  // Process hyphenated words first
  const processedWord = processHyphenatedWord(word, pos);
  if (processedWord === null) {
    return null;
  }

  // Apply lemmatization
  const lemmatizedWord = lemmatizeIt(processedWord);

  const processedEntry: ProcessedEntry = {
    ...entry,
    lemmatizedForm: lemmatizedWord,
    hint: hintWords.has(processedWord.toLowerCase()) ? "1" : "0",
  };

  return processedEntry;
}

function combineDuplicates(entries: ProcessedEntry[]): ProcessedEntry[] {
  const wordMap = new Map<string, ProcessedEntry>();

  entries.forEach((entry) => {
    const key = entry.lemmatizedForm || entry.word;

    if (wordMap.has(key)) {
      const existing = wordMap.get(key)!;
      existing.relatedEntries = existing.relatedEntries || [];

      // Store only specified fields from duplicate entries
      const duplicateInfo: Partial<WordEntry> = {};
      CONFIG.duplicateFields.forEach((field) => {
        duplicateInfo[field] = entry[field];
      });

      existing.relatedEntries.push(duplicateInfo);
      // Preserve hint value if either entry is a hint
      existing.hint = existing.hint || entry.hint;
    } else {
      wordMap.set(key, entry);
    }
  });

  return Array.from(wordMap.values());
}

// ===================== FILE OPERATIONS =====================
function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function processCSV(): Promise<void> {
  try {
    // Load hint data
    const hintWords = loadHintData();
    console.log(`Loaded ${hintWords.size} hint words`);

    // Read input file
    const inputData = fs.readFileSync(CONFIG.inputPath, "utf-8");
    const records = csv.parse(inputData, {
      columns: true,
      skip_empty_lines: true,
    }) as WordEntry[];

    const totalInitialEntries = records.length;

    // Process records with hint data
    const processedEntries = records
      .map((entry) => processWord(entry, hintWords))
      .filter((entry): entry is ProcessedEntry => entry !== null);

    // Combine duplicates
    const combinedEntries = combineDuplicates(processedEntries);

    // Ensure output directories exist
    ensureDirectoryExists(CONFIG.outputPath);

    // Write main output with only selected columns
    const outputCsv = stringify(combinedEntries, {
      header: true,
      columns: CONFIG.outputColumns,
    });
    fs.writeFileSync(CONFIG.outputPath, outputCsv);

    // Calculate hint statistics
    const hintCount = combinedEntries.filter((entry) => entry.hint).length;

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
  } catch (error) {
    console.error("Error processing CSV:", error);
    throw error;
  }
}

// ===================== EXECUTION =====================
processCSV().catch(console.error);
