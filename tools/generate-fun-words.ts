#!/usr/bin/env node --experimental-strip-types

/**
 * generate-fun-words.ts  ▸  Curate ≈1000 everyday "fun" words using semantic vectors.
 *
 * High-level approach
 * 1. Define a handful of very common *anchor words* that represent broad, friendly
 *    categories (food, animals, feelings, places, etc.).
 * 2. For each anchor, pull its nearest neighbours from the `vectors.sqlite` DB
 *    using cosine similarity (via the `sqlite-vec` extension).
 * 3. Merge all neighbours, apply lightweight heuristics (lower-case, 4-8 chars),
 *    shuffle and return the first N unique words.
 *
 * Requirements
 *   npm run add better-sqlite3 sqlite-vec            # or npm/yarn/pnpm install …
 *
 * Usage
 *   npm run tools/generate-fun-words.ts            # default 1 000 words
 *   npm run tools/generate-fun-words.ts 750        # custom count
 */

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');
const DB_FILE = join(WORDS_DIR, 'vectors.sqlite');
const OUTPUT_FILE = join(WORDS_DIR, 'fun-words.txt');

// Number of neighbours to fetch per anchor. 200×10 anchors ≈ 2 000 raw words → plenty after filtering.
const NEIGHBOURS_PER_ANCHOR = 200;
const DEFAULT_TARGET_COUNT = 1_000;

// Broad, relatable seed words. Feel free to tweak!
const ANCHORS = [
  'cat',
  'dog',
  'pizza',
  'dragon',
  'robot',
  'magic',
  'ocean',
  'forest',
  'music',
  'happy',
];

// Heuristic filters ----------------------------------------------------------------
function isCandidate(word: string): boolean {
  // a-z only, 4-8 chars, lower-case
  return /^[a-z]{4,8}$/.test(word);
}

// Simple shuffle --------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

// Main ------------------------------------------------------------------------------
async function main() {
  const [, , countArg] = process.argv;
  const TARGET_COUNT = Number(countArg ?? DEFAULT_TARGET_COUNT);

  const db = new Database(DB_FILE, { readonly: true });
  sqliteVec.load(db);

  const getEmbedding = db.prepare('SELECT embedding FROM words WHERE word = ?');
  const neighbourStmt = db.prepare(
    'SELECT word FROM words WHERE word != ? ORDER BY vec_distance_cosine(embedding, ?) LIMIT ?'
  );

  const collected: string[] = [];
  const seen = new Set<string>();

  for (const anchor of ANCHORS) {
    const row = getEmbedding.get(anchor) as { embedding?: Buffer };
    if (!row?.embedding) {
      console.warn(`⚠️  Anchor “${anchor}” missing in vocabulary – skipping`);
      continue;
    }

    for (const { word } of neighbourStmt.iterate(
      anchor,
      row.embedding,
      NEIGHBOURS_PER_ANCHOR
    ) as any) {
      if (seen.has(word)) continue;
      if (!isCandidate(word)) continue;
      seen.add(word);
      collected.push(word);
    }
  }

  console.log(`Collected ${collected.length.toLocaleString()} raw candidates.`);

  shuffle(collected);
  const final = collected.slice(0, TARGET_COUNT);
  writeFileSync(OUTPUT_FILE, final.join('\n') + '\n', 'utf8');
  console.log(`🚀  Wrote ${final.length} words → ${OUTPUT_FILE}`);

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
