// Utility functions and constants for word filtering used across tools.
// Feel free to extend this list or tweak the predicates as needs evolve.

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// OpenAI Lemmatizer Setup
// ---------------------------------------------------------------------------

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) {
    throw new Error('Missing OPENAI_API_KEY environment variable for openai.');
  }
  return key;
}

const LEMMA_SYSTEM_PROMPT = `You are a English lemmatizer.
Given a single English token, return ONLY its lemma (dictionary base form).

Rules:
- Output exactly one lowercase word, no punctuation, no quotes, no extra text.
- If the input is already a lemma, return it unchanged.
- Handle nouns, verbs, adjectives, adverbs.
- Do not translate or explain. If unsure, return the input as-is.
- Keep proper nouns lowercase as provided.

Examples:
doing -> do
apples -> apple
eyeball -> eyeball
when -> when
running -> run
children -> child
chronologically -> chronology
mathematically -> mathematics
geese -> goose`;

async function getLemmaFromOpenAI(word: string): Promise<string | null> {
  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const response = await client.responses.create({
    model: 'gpt-5',
    reasoning: {
      effort: 'minimal',
      summary: 'auto',
    },
    instructions: LEMMA_SYSTEM_PROMPT,
    input: `Input: ${word}\nOutput:`,
  });
  // Normalize: pick first alphabetical token, lowercase
  const match = response.output_text.toLowerCase().match(/[a-z'-]+/);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// LLM-based winner selection for conflicting lemmas
// ---------------------------------------------------------------------------

const DISAMBIGUATION_SYSTEM_PROMPT = `You are an English lexeme disambiguator for a word-guessing game.
Given a surface word and a SET of candidate lemmas, choose EXACTLY ONE candidate that best represents the core base lexeme by meaning.

Decision rules (in order):
1) Prefer the inflectional headword over derivational forms.
   - Past/past-participle/gerund forms → choose the verb base (e.g., worn → wear)
   - Plural/singular nouns → choose the noun lemma (e.g., weights → weight)
2) If candidates are different parts of speech, prefer the one most consistent with the surface form:
   - Looks like plural noun (-s/-es) → choose a noun lemma if present.
   - Looks like verb inflection (-ed/-ing/-s for 3sg, irregular past/participle) → choose the verb lemma.
3) Prefer American spelling among otherwise equivalent candidates.
4) If still tied, choose the more general, widely-used headword.

Output format:
- Return ONLY one of the provided candidates in lowercase.
- Do NOT add punctuation, quotes, or any extra text.`;

export async function chooseWinningLemma(word: string, candidates: string[]): Promise<string> {
  const normalizedWord = word.toLowerCase();
  const uniqueCandidates = Array.from(new Set(candidates.map((c) => c.toLowerCase())));
  if (uniqueCandidates.length === 1) return uniqueCandidates[0]!;

  // Sort for determinism in prompt and to stabilize tie-breaks
  uniqueCandidates.sort((a, b) => a.localeCompare(b));

  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const prompt = `Word: ${normalizedWord}\nCandidates: ${uniqueCandidates.join(' | ')}\nAnswer:`;
  try {
    const response = await client.responses.create({
      model: 'gpt-5',
      reasoning: { effort: 'minimal', summary: 'auto' },
      instructions: DISAMBIGUATION_SYSTEM_PROMPT,
      input: prompt,
    });
    const out = (response.output_text || '').trim().toLowerCase();
    const match = uniqueCandidates.find((c) => c === out);
    if (match) return match;
  } catch (err) {
    console.warn(
      `[llm-disambiguate] Failed for ${normalizedWord} with candidates ${uniqueCandidates.join(', ')}:`,
      err
    );
  }

  // Fallbacks if the model didn't return a valid candidate
  // 1) If the word equals a candidate, prefer it
  const exact = uniqueCandidates.find((c) => c === normalizedWord);
  if (exact) return exact;
  // 2) Prefer candidate that shares the longest common prefix with the word
  let best = uniqueCandidates[0]!;
  let bestScore = -1;
  for (const cand of uniqueCandidates) {
    let i = 0;
    while (i < Math.min(cand.length, normalizedWord.length) && cand[i] === normalizedWord[i]) i++;
    if (i > bestScore) {
      bestScore = i;
      best = cand;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Lemma CSV writer
// ---------------------------------------------------------------------------

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const LEMMA_OUT_DIR = path.join(THIS_DIR, '..', 'new');
const LEMMA_OUT_FILE = path.join(LEMMA_OUT_DIR, 'lemma.csv');

let lemmaFileInitialized = false;

async function ensureLemmaFileReady(): Promise<void> {
  if (lemmaFileInitialized) return;
  await fs.mkdir(LEMMA_OUT_DIR, { recursive: true });
  try {
    await fs.access(LEMMA_OUT_FILE);
  } catch {
    await fs.writeFile(LEMMA_OUT_FILE, 'word,lemma\n', 'utf8');
  }
  lemmaFileInitialized = true;
}

async function appendLemmaPair(original: string, lemma: string): Promise<void> {
  await ensureLemmaFileReady();
  await fs.appendFile(LEMMA_OUT_FILE, `${original},${lemma}\n`, 'utf8');
}

class ProfanityFilter {
  private profanitySet: Set<string>;

  constructor() {
    const { profanitySet } = this.generateProfanityLists();
    this.profanitySet = profanitySet;
  }

  private generateProfanityLists(): {
    profanitySet: Set<string>;
    profanitySubstrings: Set<string>;
  } {
    // Base profanity words
    const baseProfanity = new Set([
      // Sexual terms
      'fuck',
      'shit',
      'cock',
      'dick',
      'penis',
      'pussy',
      'cunt',
      'vagina',
      'cum',
      'semen',
      'whore',
      'slut',
      'bitch',
      'hooker',
      'hoe',
      'skank',
      'queer',
      'fag',
      'dyke',

      // Excretory terms
      'piss',
      'poop',
      'crap',
      'ass',
      'arse',
      'butt',

      // Slurs and offensive terms
      'nigger',
      'nigga',
      'chink',
      'spic',
      'wetback',
      'kike',
      'kyke',
      'fagot',
      'faggot',
      'retard',
      'tard',
      'homo',
      'tranny',
      'twat',
      'paki',
      'gook',
      'honky',
      'wop',
      'dago',
      'raghead',
      'towelhead',
      'beaner',
      'gringo',
      'cracka',
      'cracker',
      'redneck',
      'whitey',
      'zipperhead',
      'wigger',
      'wigga',
      'wog',
      'yid',

      // Religious/blasphemous
      'goddamn',
      'goddam',
      'damn',
      'hell',
      'bastard',

      // Body parts
      'tit',
      'tits',
      'titty',
      'boob',
      'knocker',
      'ballsack',
      'nuts',
      'nutsack',

      // Other offensive
      'douche',
      'douchebag',
      'scumbag',
      'motherfucker',
      'fucker',
      'wanker',
      'bollocks',
      'prick',
      'schmuck',
      'asshole',
      'arsehole',
      'jackass',
      'dumbass',
      'dipshit',
      'cocksucker',
      'blowjob',
      'handjob',
      'rimjob',
      'jizz',
      'spunk',
      'dildo',
      'dong',
      'wang',
      'schlong',
      'dingus',
      'weiner',
      'wiener',
      'knob',
      'pecker',
      'chode',
    ]);

    // Common prefixes
    const prefixes = new Set([
      'dumb',
      'horse',
      'bull',
      'chicken',
      'jack',
      'ass',
      'mother',
      'dog',
      'pig',
      'dick',
      'cock',
      'pussy',
      'cunt',
      'butt',
      'cum',
      'jizz',
      'circle',
    ]);

    // Common suffixes
    const suffixes = new Set([
      'hole',
      'head',
      'face',
      'wipe',
      'wad',
      'stain',
      'bag',
      'sucker',
      'licker',
      'lover',
      'fucker',
      'eating',
      'sucking',
      'jockey',
      'monkey',
      'breath',
      'brain',
    ]);

    // Common variations
    const variations = new Set(['ing', 'er', 'ed', 'y', 'ier', 'iest', 'in', 'ez', 'es', 's']);

    // Generate compound words and variations
    const profanitySet = new Set(baseProfanity);

    // Add prefix+base combinations
    for (const prefix of prefixes) {
      for (const base of baseProfanity) {
        profanitySet.add(prefix + base);
      }
    }

    // Add base+suffix combinations
    for (const base of baseProfanity) {
      for (const suffix of suffixes) {
        profanitySet.add(base + suffix);
      }
    }

    // Add variations of base words
    for (const word of baseProfanity) {
      for (const variation of variations) {
        profanitySet.add(word + variation);
      }
    }

    return { profanitySet, profanitySubstrings: new Set() };
  }

  isProfane(word: string): boolean {
    const lowerWord = word.toLowerCase().trim();

    // Only check exact matches
    return this.profanitySet.has(lowerWord);
  }
}

// Singleton instance for performance
const profanityFilter = new ProfanityFilter();

export type WordFilter = {
  name: string;
  fn: (word: string) => boolean | Promise<boolean>;
};

// ---------------------------------------------------------------------------
// British → American spelling remap (hard-coded)
// ---------------------------------------------------------------------------

export const BRITISH_TO_AMERICAN_MAP = new Map<string, string>([
  // -yse → -yze
  ['analyse', 'analyze'],
  ['paralyse', 'paralyze'],
  ['catalyse', 'catalyze'],
  ['dialyse', 'dialyze'],
  ['lyse', 'lyze'],
  // -iser/-izer agentives
  ['analyser', 'analyzer'],
  ['organiser', 'organizer'],
  ['realiser', 'realizer'],
  ['recogniser', 'recognizer'],
  // -ise → -ize (sample)
  ['organise', 'organize'],
  ['recognise', 'recognize'],
  ['realise', 'realize'],
  ['stabilise', 'stabilize'],
  ['generalise', 'generalize'],
  ['prioritise', 'prioritize'],
  ['apologise', 'apologize'],
  ['emphasise', 'emphasize'],
  ['normalise', 'normalize'],
  ['publicise', 'publicize'],
  // -isation → -ization
  ['organisation', 'organization'],
  ['realisation', 'realization'],
  ['stabilisation', 'stabilization'],
  ['generalisation', 'generalization'],
  ['prioritisation', 'prioritization'],
  ['emphasisation', 'emphasization'],
  ['normalisation', 'normalization'],
  ['publicisation', 'publicization'],
  // -our → -or
  ['colour', 'color'],
  ['favour', 'favor'],
  ['behaviour', 'behavior'],
  ['neighbour', 'neighbor'],
  ['honour', 'honor'],
  ['labour', 'labor'],
  ['rumour', 'rumor'],
  ['humour', 'humor'],
  ['endeavour', 'endeavor'],
  ['armour', 'armor'],
  // -re → -er
  ['centre', 'center'],
  ['metre', 'meter'],
  ['litre', 'liter'],
  ['theatre', 'theater'],
  ['calibre', 'caliber'],
  ['fibre', 'fiber'],
  // -ogue → -og (common US variant)
  ['catalogue', 'catalog'],
  ['dialogue', 'dialog'],
  ['monologue', 'monolog'],
]);

export function isBritishVariant(word: string): boolean {
  return BRITISH_TO_AMERICAN_MAP.has(word.toLowerCase());
}

// Ordered list of filters.  The first matching rule short-circuits evaluation.
export const filters: WordFilter[] = [
  {
    name: 'isBritishVariant',
    fn: (w) => isBritishVariant(w),
  },
  {
    name: 'hasNumbers',
    fn: (w) => /\d/.test(w),
  },
  {
    name: 'isWebsite',
    fn: (w) => /^(https?:\/\/)?(www\.)?[\w.-]+\.[a-z]{2,}(?:\.[a-z]{2,})?(\/.*)?$/i.test(w),
  },
  {
    name: 'isNonEnglish',
    // Any character not in basic English letters or apostrophe/hyphen.
    fn: (w) => /[^a-zA-Z'-]/.test(w),
  },
  {
    name: 'isSpecialCharacter',
    fn: (w) => /[!@#$%^&*\-()_+=[\]{};':"\\|,.<>/?]/.test(w),
  },
  {
    name: 'isSingleLetter',
    fn: (w) => w.length === 1,
  },
  {
    name: 'isWeirdAcronym',
    // 3-6 letters with NO vowels (a, e, i, o, u) – tends to be nonsensical abbreviations.
    // Previously we flagged words with ≤1 vowel, but that caught many perfectly valid
    // English words like "hat". Tightening the check to *zero* vowels keeps the
    // original intent (catch things like "xqzt" or "rndm") while letting normal
    // short words through.
    fn: (w) => {
      if (!/^[a-z]{3,6}$/i.test(w)) return false;
      if (/y/i.test(w)) return false; // allow words that contain 'y'
      const vowels = w.match(/[aeiou]/gi) || [];
      return vowels.length === 0;
    },
  },
  {
    name: 'hypens',
    fn: (w) => w.includes('--'),
  },
  {
    name: 'repeatingLetters',
    fn: (w) =>
      [
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
        'g',
        'h',
        'i',
        'j',
        'k',
        'l',
        'm',
        'n',
        'o',
        'p',
        'q',
        'r',
        's',
        't',
        'u',
        'v',
        'w',
        'x',
        'y',
        'z',
      ].some((letter) => w.includes(letter.repeat(4))),
  },
  {
    name: 'isProfane',
    fn: (w) => profanityFilter.isProfane(w),
  },
  // {
  //   name: 'lemmatized',
  //   fn: async (w) => {
  //     // Skip very short or non-basic tokens; other filters handle special chars already
  //     if (w.length < 2 || /[^a-zA-Z'-]/.test(w)) {
  //       console.log(`[lemma] ${w} -> (skipped) [kept]`);
  //       return false;
  //     }
  //     const lower = w.toLowerCase();
  //     const lemma = await getLemmaFromOpenAI(lower);
  //     if (!lemma) {
  //       console.log(`[lemma] ${lower} -> (none) [kept]`);
  //       return false;
  //     }
  //     const filtered = lemma !== lower;
  //     console.log(`[lemma] ${lower} -> ${lemma} [${filtered ? 'filtered' : 'kept'}]`);
  //     if (filtered) {
  //       try {
  //         await appendLemmaPair(lower, lemma);
  //       } catch (err) {
  //         console.warn(`Failed writing lemma pair to CSV for ${lower} -> ${lemma}:`, err);
  //       }
  //     }
  //     return filtered; // filter if not already lemma form
  //   },
  // },
];

/**
 * Returns true if the word should be filtered (i.e. excluded from datasets).
 */
export async function shouldFilterAsync(word: string): Promise<boolean> {
  for (const f of filters) {
    const res = await Promise.resolve(f.fn(word));
    if (res) return true;
  }
  return false;
}

/**
 * Validates a list of words.
 * - Throws if there are duplicates (case-insensitive, trimmed comparison)
 * - Throws if any word would be filtered by the configured filters
 */
export async function validateWordList(words: string[]): Promise<void> {
  // Detect duplicates using a normalized representation
  const seen = new Set<string>();
  const duplicateSet = new Set<string>();
  for (const word of words) {
    const normalized = word.toLowerCase().trim();
    if (seen.has(normalized)) {
      duplicateSet.add(normalized);
    } else {
      seen.add(normalized);
    }
  }

  if (duplicateSet.size > 0) {
    const duplicates = Array.from(duplicateSet).sort();
    throw new Error(`Duplicate words detected: ${duplicates.join(', ')}`);
  }

  // Check filtering in parallel for performance
  const filterResults = await Promise.all(words.map((w) => shouldFilterAsync(w)));
  const filteredWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (filterResults[i]) filteredWords.push(words[i]!);
  }

  if (filteredWords.length > 0) {
    // De-duplicate while preserving original casing ordering of first occurrences
    const seenFiltered = new Set<string>();
    const uniqueFiltered = filteredWords.filter((w) => {
      const key = w.toLowerCase().trim();
      if (seenFiltered.has(key)) return false;
      seenFiltered.add(key);
      return true;
    });
    throw new Error(`Filtered words detected: ${uniqueFiltered.join(', ')}`);
  }
}
