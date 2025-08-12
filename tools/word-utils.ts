// Utility functions and constants for word filtering used across tools.
// Feel free to extend this list or tweak the predicates as needs evolve.

import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
// Path to write lemma lookup table (generated at runtime)
const LEMMA_CSV_PATH = path.join(TOOLS_DIR, '..', 'words', 'lemma.csv');
// In-memory cache of word ➜ lemma mappings discovered during processing
const lemmaMap = new Map<string, string>();

// ---------------------------------------------------------------------------
// Manual lemma overrides for words that the automatic lemmatizer gets wrong.
// ONLY insert lowercase words here. The key is the original word, the value
// is its correct lemma form.
// ---------------------------------------------------------------------------
const LEMMA_OVERRIDES: Record<string, string> = {
  was: 'be',
  has: 'have',
  reddits: 'reddit',
};

// Flush the collected mappings to disk when the current Node process exits. This
// guarantees that large batch scripts (e.g. test-filter-words.ts) only perform
// a single write at the very end rather than for every word.
process.on('exit', () => {
  if (lemmaMap.size === 0) return;
  try {
    // Ensure the destination directory exists (it should for the filter tools,
    // but make this defensive so other callers are safe too).
    mkdirSync(path.dirname(LEMMA_CSV_PATH), { recursive: true });
    let csv = 'word,lemma\n';
    for (const [word, lemma] of lemmaMap) {
      csv += `${word},${lemma}\n`;
    }
    writeFileSync(LEMMA_CSV_PATH, csv, 'utf8');
  } catch (err) {
    console.warn('⚠️  Unable to write lemma lookup CSV:', err);
  }
});

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

// ---------------------------------------------------------------------------
// LemmaServer – maintains a persistent Python (lemminflect) subprocess
// ---------------------------------------------------------------------------

class LemmaServer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: Array<{ resolve: (lemmas: string[]) => void; reject: (err: Error) => void }> = [];
  private buffer = '';

  constructor() {
    this.start();
  }

  private start() {
    const PY_CODE = `import sys, json, lemminflect\nPOS = ['NOUN','VERB','ADJ','ADV']\nfor line in sys.stdin:\n    w = line.strip()\n    lemmas = set()\n    for tag in POS:\n        lemmas.update(lemminflect.getLemma(w, upos=tag))\n    print(json.dumps(list(lemmas)), flush=True)`;

    try {
      this.proc = spawn('python3', ['-u', '-c', PY_CODE]);
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (data: Buffer | string) => this.handleStdout(data.toString()));
      this.proc.on('exit', (code) => {
        const err = new Error(`LemmaServer exited with code ${code}`);
        while (this.queue.length) this.queue.shift()!.reject(err);
        this.proc = null;
      });
    } catch (err) {
      console.warn('⚠️  Unable to start LemmaServer:', err);
    }
  }

  private handleStdout(chunk: string) {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const pending = this.queue.shift();
      if (!pending) continue;
      try {
        pending.resolve(JSON.parse(line));
      } catch (err) {
        pending.reject(err as Error);
      }
    }
  }

  async getLemmas(word: string): Promise<string[]> {
    if (!this.proc) return [];
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.proc!.stdin.write(word + '\n');
    });
  }
}

// Singleton instance
const lemmaServer = new LemmaServer();

export type WordFilter = {
  name: string;
  fn: (word: string) => boolean | Promise<boolean>;
};

// Ordered list of filters.  The first matching rule short-circuits evaluation.
export const filters: WordFilter[] = [
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
    fn: (w) => /[!@#$%^&*()_+=[\]{};':"\\|,.<>/?]/.test(w),
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
  {
    name: 'lemmatized',
    fn: async (w) => {
      // Skip very short words or words with special characters as LemmInflect may not handle them well
      if (w.length < 3 || /[^a-zA-Z'-]/.test(w)) {
        return false;
      }

      try {
        const lowerWord = w.toLowerCase();

        // Check manual overrides first
        const overrideLemma = LEMMA_OVERRIDES[lowerWord as keyof typeof LEMMA_OVERRIDES];
        if (overrideLemma !== undefined) {
          if (overrideLemma === lowerWord) {
            return false; // already lemma form – keep the word
          }
          lemmaMap.set(lowerWord, overrideLemma);
          return true; // filter because not already lemma form
        }

        const lemmas = await lemmaServer.getLemmas(lowerWord);
        if (!lemmas.includes(lowerWord)) {
          const lemma = lemmas[0] ?? lowerWord;
          lemmaMap.set(lowerWord, lemma);
          return true; // filter because not already lemma form
        }
        return false; // already lemma – keep the word
      } catch {
        return false;
      }
      /*
      // Leverage the Python `lemminflect` library (via a child process) to determine
      // if the provided word is already in its lemmatized/base form.  We purposefully
      // keep the Python logic self-contained so that developers do not need to add
      // heavyweight JS NLP dependencies.
      try {
        const pythonCode = `import sys, json, lemminflect\nword = sys.argv[1]\npos_tags = ['NOUN','VERB','ADJ','ADV']\nlemmas = set()\nfor tag in pos_tags:\n    lemmas.update(lemminflect.getLemma(word, upos=tag))\nprint(json.dumps(list(lemmas)))`;

        const result = spawnSync('python3', ['-c', pythonCode, w.toLowerCase()], {
          encoding: 'utf8',
        });

        if (result.status !== 0 || !result.stdout) {
          // If the Python process fails (missing python3 or lemminflect), default to
          // keeping the word (i.e., do NOT filter) so we never accidentally lose data.
          return false;
        }

        let lemmas: string[] = [];
        try {
          lemmas = JSON.parse(result.stdout.trim());
        } catch {
          // Unable to parse output – play it safe and keep the word.
          return false;
        }

        const lowerWord = w.toLowerCase();
        const isLemma = lemmas.some((l) => l === lowerWord);

        // Filter the word only if it is NOT already a lemma.
        return !isLemma;
      } catch {
        // Any unexpected runtime error – keep the word.
        return false;
      }
      */
    },
  },
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
