#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const INPUT_CSV_DEFAULT = join(ROOT_DIR, 'words', 'new', 'lemma-map-full.csv');
const OUTPUT_CSV_DEFAULT = join(ROOT_DIR, 'words', 'new', 'lemma-map-full.cleaned.csv');
const WORDNET_CSV_DEFAULT = join(ROOT_DIR, 'words-new', 'output', 'wordnet.csv');

// Words frequently hallucinated from instructions/system text that should never appear as variants
const META_STOPWORDS = new Set<string>([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'only',
  'also',
  'not',
  'no',
  'yes',
  'be',
  'is',
  'are',
  'was',
  'were',
  'been',
  'being',
  'to',
  'of',
  'for',
  'from',
  'with',
  'without',
  'in',
  'on',
  'at',
  'by',
  'as',
  'than',
  'then',
  'therefore',
  'so',
  'that',
  'thats', // that's → thats
  'i',
  'we',
  'you',
  'they',
  'he',
  'she',
  'it',
  'my',
  'your',
  'our',
  'their',
  'people',
  'could',
  'should',
  'must',
  'can',
  'output',
  'per',
  'rules',
  'rule',
  'developer',
  'instruction',
  'instructions',
  'note',
  'notes',
  'role',
  'context',
  'input',
  'include',
  'inclusions',
  'exclude',
  'exclusions',
  'decision',
  'formatting',
  'format',
  'checklist',
  'example',
  'examples',
  'valid',
  'invalid',
  'unattested',
  'attested',
  'proper',
  'referring',
  'casing',
  'lowercase',
  'uppercase',
  'titlecase',
  'text',
  'csv',
  'spaces',
  'single',
  'word',
  'singleword',
  'multiword',
  'hyphen',
  'hyphenated',
  // Specific junk seen in examples
  'comparative',
  'plural',
  'noun',
  'nouns',
  'adjective',
  'adjectives',
  'adverb',
  'adverbs',
  'derived',
  'expansions',
  'expansion',
  'form',
  'forms',
  'therefore',
  'thats',
]);

const IRREGULAR_KEEP: Record<string, ReadonlySet<string>> = {
  much: new Set(['more', 'most']),
  many: new Set(['more', 'most']),
  good: new Set(['better', 'best']),
  bad: new Set(['worse', 'worst']),
  far: new Set(['farther', 'farthest', 'further', 'furthest']),
  run: new Set(['ran', 'run', 'runs', 'running']),
};

type Pos = 'n' | 'v' | 'a' | 'r' | string;
type WordPosMap = Map<string, Set<Pos>>;

function isAlphaWord(s: string): boolean {
  return /^[a-z]+$/.test(s);
}

function splitCsvLineRespectingQuotes(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

async function loadWordNetLexicon(
  path: string
): Promise<{ lexicon: Set<string>; posMap: WordPosMap }> {
  const lexicon = new Set<string>();
  const posMap: WordPosMap = new Map();
  try {
    const raw = await fsp.readFile(path, 'utf8');
    const lines = raw.split(/\r?\n/);
    // Expect header present; start at 1
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = splitCsvLineRespectingQuotes(line);
      if (cols.length < 7) continue;
      const word = (cols[0] || '').trim().toLowerCase();
      const pos = (cols[3] || '').trim().toLowerCase() as Pos;
      const synonyms = (cols[6] || '').trim().toLowerCase();
      const addToken = (t: string) => {
        if (!t) return;
        if (!isAlphaWord(t)) return;
        lexicon.add(t);
        let set = posMap.get(t);
        if (!set) {
          set = new Set<Pos>();
          posMap.set(t, set);
        }
        set.add(pos);
      };
      if (isAlphaWord(word)) addToken(word);
      if (synonyms) {
        for (const syn of synonyms.split(';')) {
          const s = syn.trim();
          if (!s) continue;
          if (isAlphaWord(s)) addToken(s);
        }
      }
    }
  } catch (err) {
    console.warn(`[cleaner] Failed to load WordNet lexicon from ${path}:`, (err as Error).message);
  }
  return { lexicon, posMap };
}

function normalizeToken(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (!/^[a-z]+$/.test(t)) return null; // letters only; drop hyphens, apostrophes, digits, etc.
  if (t.length < 3) return null; // drop single letters and most junk
  if (META_STOPWORDS.has(t)) return null;
  return t;
}

function isDemonymLike(lemma: string): boolean {
  return /(?:ian|ean|ese|ish)$/.test(lemma);
}

function plausibleMorphologicalRelation(
  lemma: string,
  variant: string,
  opts: {
    lexicon: Set<string>;
    posMap: WordPosMap;
  }
): boolean {
  if (variant === lemma) return false;
  const irregular = IRREGULAR_KEEP[lemma];
  if (irregular) {
    // Strict for irregular lemmas: accept only the whitelisted irregular forms
    return irregular.has(variant);
  }

  // Accept variants that contain the lemma or common stem alternations
  const bases = new Set<string>();
  bases.add(lemma);
  if (lemma.endsWith('e')) bases.add(lemma.slice(0, -1)); // move → moving
  if (lemma.endsWith('y')) bases.add(lemma.slice(0, -1) + 'i'); // happy → happier

  const { lexicon, posMap } = opts;
  const lemmaPos = posMap.get(lemma) || new Set<Pos>();
  const demonym = isDemonymLike(lemma);

  // If the variant is a real dictionary word, prefer to accept (subject to meta filters already applied)
  if (lexicon.has(variant)) return true;

  // Inflectional morphology with POS checks
  for (const base of bases) {
    // Verb inflections: ing/ed/s
    if (lemmaPos.has('v')) {
      if (variant === base + 'ing' || variant === base + 'ed') return true;
      if (variant === base + 's' || variant === base + 'es') return true;
    }
    // Noun plurals: s/es
    if (lemmaPos.has('n')) {
      if (variant === base + 's' || variant === base + 'es') return true;
    }
    // Adjective comparatives/superlatives: er/est (disallow for demonyms)
    if (lemmaPos.has('a') && !demonym) {
      if (variant === base + 'er' || variant === base + 'est') return true;
    }
    // Agentive from verb: er/ers (require verb POS)
    if (lemmaPos.has('v')) {
      if (variant === base + 'er' || variant === base + 'ers') return true;
    }
    // Adverb from adjective: ly (disallow for demonyms)
    if (lemmaPos.has('a') && !demonym) {
      if (variant === base + 'ly' || variant === base + 'ally') return true;
    }
    // Nominalizations: ness from adjectives (disallow for demonyms)
    if (lemmaPos.has('a') && !demonym) {
      if (variant === base + 'ness') return true;
    }
  }

  return false;
}

async function loadCsv(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function* iterateCsvLines(csv: string): Generator<{ word: string; lemma: string }> {
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /^\s*word\s*,\s*lemma\s*$/i.test(line)) continue; // skip header
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const rawWord = line.slice(0, comma);
    const rawLemma = line.slice(comma + 1);
    const word = normalizeToken(rawWord) ?? '';
    const lemma = normalizeToken(rawLemma) ?? '';
    if (!word || !lemma) continue;
    yield { word, lemma };
  }
}

async function writeCsv(path: string, rows: Array<{ word: string; lemma: string }>): Promise<void> {
  await fsp.writeFile(
    path,
    'word,lemma\n' + rows.map((r) => `${r.word},${r.lemma}`).join('\n') + (rows.length ? '\n' : ''),
    'utf8'
  );
}

async function main() {
  const [, , inputArg, outputArg, wordnetArg] = process.argv;
  const inputPath = inputArg && inputArg !== '-' ? inputArg : INPUT_CSV_DEFAULT;
  const outputPath = outputArg && outputArg !== '-' ? outputArg : OUTPUT_CSV_DEFAULT;
  const wordnetPath = wordnetArg && wordnetArg !== '-' ? wordnetArg : WORDNET_CSV_DEFAULT;

  const csv = await loadCsv(inputPath);
  const { lexicon, posMap } = await loadWordNetLexicon(wordnetPath);

  const keptRows: Array<{ word: string; lemma: string }> = [];
  const seen = new Set<string>();
  let total = 0;
  let droppedNonAlphaOrStop = 0;
  let droppedImplausible = 0;
  const cleanedByLemma = new Map<string, Set<string>>();
  const removedPairs: Array<{ word: string; lemma: string }> = [];

  for (const { word, lemma } of iterateCsvLines(csv)) {
    total++;
    // normalizeToken already filters non-alpha, stopwords, short tokens
    if (
      !/^[a-z]+$/.test(word) ||
      !/^[a-z]+$/.test(lemma) ||
      META_STOPWORDS.has(word) ||
      META_STOPWORDS.has(lemma) ||
      word.length < 3 ||
      lemma.length < 3
    ) {
      droppedNonAlphaOrStop++;
      let set = cleanedByLemma.get(lemma);
      if (!set) {
        set = new Set<string>();
        cleanedByLemma.set(lemma, set);
      }
      set.add(word);
      removedPairs.push({ word, lemma });
      continue;
    }
    if (!plausibleMorphologicalRelation(lemma, word, { lexicon, posMap })) {
      droppedImplausible++;
      let set = cleanedByLemma.get(lemma);
      if (!set) {
        set = new Set<string>();
        cleanedByLemma.set(lemma, set);
      }
      set.add(word);
      removedPairs.push({ word, lemma });
      continue;
    }
    const key = `${word},${lemma}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keptRows.push({ word, lemma });
  }

  keptRows.sort((a, b) =>
    a.lemma === b.lemma ? a.word.localeCompare(b.word) : a.lemma.localeCompare(b.lemma)
  );
  await writeCsv(outputPath, keptRows);

  console.log(`Cleaned lemma map written to ${outputPath}`);
  // Emit a flat list of removed pairs (word,lemma) for spot checks
  if (removedPairs.length > 0) {
    removedPairs.sort((a, b) =>
      a.lemma === b.lemma ? a.word.localeCompare(b.word) : a.lemma.localeCompare(b.lemma)
    );
    console.log('\nRemoved pairs (word,lemma):');
    for (const p of removedPairs) {
      console.log(`${p.word},${p.lemma}`);
    }
  }
  console.table({
    inputRows: total,
    keptRows: keptRows.length,
    droppedNonAlphaOrStop,
    droppedImplausible,
    inputPath,
    outputPath,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
