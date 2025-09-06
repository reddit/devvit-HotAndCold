#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const WORDS_DIR = join(ROOT_DIR, 'words');
const WORDS_NEW_DIR = join(WORDS_DIR, 'new');
const WORDS_FINAL_DIR = join(ROOT_DIR, 'words-final');

const INPUT_LEMMA_CSV = join(WORDS_NEW_DIR, 'lemma-map-full.retried.final.csv');
const INPUT_WORDLIST_TXT = join(WORDS_NEW_DIR, 'extracted.txt');

const OUTPUT_LEMMA_CSV = join(WORDS_FINAL_DIR, 'lemma.csv');
const OUTPUT_WORDLIST_CSV = join(WORDS_FINAL_DIR, 'word-list.csv');

type Pair = { word: string; lemma: string };

async function ensureDir(path: string): Promise<void> {
  await fsp.mkdir(path, { recursive: true });
}

async function readText(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function parseLemmaCsv(csv: string): Pair[] {
  const out: Pair[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /\bword\s*,\s*lemma\b/i.test(line)) continue; // header
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const word = line.slice(0, comma).trim().toLowerCase();
    const lemma = line
      .slice(comma + 1)
      .trim()
      .toLowerCase();
    if (!word || !lemma) continue;
    out.push({ word, lemma });
  }
  return out;
}

function parseWordList(txt: string): Set<string> {
  const set = new Set<string>();
  for (const line of txt.split(/\r?\n/)) {
    const w = line.trim().toLowerCase();
    if (!w) continue;
    set.add(w);
  }
  return set;
}

function filterLemmaPairs(
  pairs: Pair[],
  wordSet: Set<string>
): {
  finalPairs: Pair[];
  removedLemmaNotInList: number;
  removedWordInList: number;
} {
  const finalPairs: Pair[] = [];
  let removedLemmaNotInList = 0;
  let removedWordInList = 0;

  for (const p of pairs) {
    const lemmaInWordList = wordSet.has(p.lemma);
    if (!lemmaInWordList) {
      console.warn(
        `[lemma-missing] Removing pair because lemma not in word list: ${p.word},${p.lemma}`
      );
      removedLemmaNotInList++;
      continue;
    }

    const wordIsInWordList = wordSet.has(p.word);
    if (wordIsInWordList) {
      console.log(
        `[word-conflict] Removing pair because word found in word list: ${p.word},${p.lemma}`
      );
      removedWordInList++;
      continue;
    }

    finalPairs.push(p);
  }

  return { finalPairs, removedLemmaNotInList, removedWordInList };
}

function ensureAllLemmasInWordList(finalPairs: Pair[], wordSet: Set<string>): void {
  for (const p of finalPairs) {
    if (!wordSet.has(p.lemma)) {
      // This should not happen since we filtered above, but guard just in case
      throw new Error(
        `Invariant violated: lemma ${p.lemma} missing from word list after filtering.`
      );
    }
  }
}

async function writeCsv(path: string, header: string, rows: string[][]): Promise<void> {
  const content = [header, ...rows.map((r) => r.join(','))].join('\n') + '\n';
  await fsp.writeFile(path, content, 'utf8');
}

async function main() {
  const [lemmaCsvPathArg, wordListPathArg] = process.argv.slice(2);
  const lemmaCsvPath = lemmaCsvPathArg ?? INPUT_LEMMA_CSV;
  const wordListPath = wordListPathArg ?? INPUT_WORDLIST_TXT;

  const [lemmaCsv, wordTxt] = await Promise.all([readText(lemmaCsvPath), readText(wordListPath)]);
  const pairs = parseLemmaCsv(lemmaCsv);
  const wordSet = parseWordList(wordTxt);

  const { finalPairs, removedLemmaNotInList, removedWordInList } = filterLemmaPairs(pairs, wordSet);
  ensureAllLemmasInWordList(finalPairs, wordSet);

  await ensureDir(WORDS_FINAL_DIR);

  // Write finalized lemma.csv
  await writeCsv(
    OUTPUT_LEMMA_CSV,
    'word,lemma',
    finalPairs.map((p) => [p.word, p.lemma])
  );

  // Write finalized word-list.csv from the input set (sorted)
  const finalWordList = Array.from(wordSet);
  finalWordList.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  await writeCsv(
    OUTPUT_WORDLIST_CSV,
    'word',
    finalWordList.map((w) => [w])
  );

  console.log(`Input lemma pairs: ${pairs.length.toLocaleString()}`);
  console.log(`Removed (lemma-not-in-word-list): ${removedLemmaNotInList.toLocaleString()}`);
  console.log(`Removed (word-was-in-word-list): ${removedWordInList.toLocaleString()}`);
  console.log(`Final lemma pairs: ${finalPairs.length.toLocaleString()}`);
  console.log(`Final word list size: ${finalWordList.length.toLocaleString()}`);
  console.log(`Wrote lemma CSV: ${OUTPUT_LEMMA_CSV}`);
  console.log(`Wrote word list CSV: ${OUTPUT_WORDLIST_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


