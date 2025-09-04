#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const WORDS_NEW_DIR = join(ROOT_DIR, 'words', 'new');

const LEMMA_CSV = join(WORDS_NEW_DIR, 'lemma-map-full.csv');
const EXTRACTED_TXT = join(WORDS_NEW_DIR, 'extracted.txt');

type LemmaRow = { word: string; lemma: string };

async function loadExtractedSet(path: string): Promise<Set<string>> {
  const raw = await fsp.readFile(path, 'utf8').catch(async (err) => {
    throw new Error(
      `Failed to read extracted list at ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  const set = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim();
    if (!w || w.startsWith('#')) continue;
    set.add(w.toLowerCase());
  }
  return set;
}

async function loadLemmaCsv(path: string): Promise<LemmaRow[]> {
  const raw = await fsp.readFile(path, 'utf8').catch(async (err) => {
    throw new Error(
      `Failed to read lemma CSV at ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  });
  const rows: LemmaRow[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (i === 0) {
      // Expect header: word,lemma
      continue;
    }
    const [word, lemma] = line.split(',');
    if (!word || !lemma) continue;
    rows.push({ word: word.trim(), lemma: lemma.trim() });
  }
  return rows;
}

async function main() {
  const [, , /*node*/ /*script*/ outputMode] = process.argv;
  const outputJson = outputMode === '--json';

  const [extractedSet, lemmaRows] = await Promise.all([
    loadExtractedSet(EXTRACTED_TXT),
    loadLemmaCsv(LEMMA_CSV),
  ]);

  // A word is considered mistakenly lemmatized if it maps to a different lemma
  // but the original word is present in the extracted list.
  const mistakenWordsSet = new Set<string>();
  const mistakenPairs: Array<{ word: string; lemma: string }> = [];

  for (const { word, lemma } of lemmaRows) {
    const w = word.trim();
    const l = lemma.trim();
    if (!w || !l) continue;
    if (w.toLowerCase() === l.toLowerCase()) continue;
    if (extractedSet.has(w.toLowerCase())) {
      const key = w.toLowerCase();
      if (!mistakenWordsSet.has(key)) {
        mistakenWordsSet.add(key);
      }
      mistakenPairs.push({ word: w, lemma: l });
    }
  }

  const mistakenWords = Array.from(mistakenWordsSet).sort((a, b) => a.localeCompare(b));

  if (outputJson) {
    const payload = {
      count: mistakenWords.length,
      words: mistakenWords,
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Examined ${lemmaRows.length.toLocaleString()} lemma rows`);
    console.log(`Extracted list size: ${extractedSet.size.toLocaleString()}`);
    console.log(
      `Found ${mistakenWords.length.toLocaleString()} mistakenly lemmatized words (exist in extracted list but mapped to a different lemma).`
    );
    console.log('--- Words ---');
    for (const w of mistakenWords) {
      console.log(w);
    }
    console.log('--- Sample mappings (first 50) ---');
    for (let i = 0, shown = 0; i < mistakenPairs.length && shown < 50; i++) {
      const { word, lemma } = mistakenPairs[i]!;
      if (!mistakenWordsSet.has(word.toLowerCase())) continue;
      console.log(`${word} -> ${lemma}`);
      shown++;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
