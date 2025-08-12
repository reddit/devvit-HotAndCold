#!/usr/bin/env node --experimental-strip-types

/**
 * Ingest a plain-text GloVe-style vector file into SQLite and, using the
 * `sqlite-vec` extension, return the 250 words that are *most similar* to a target
 * word by cosine similarity (1 − cosine distance; identical direction ⇒ similarity≈1).
 *
 * The first time you run the script it will create a tiny on-disk SQLite
 * database called `vectors.sqlite` next to the vector file. Subsequent runs
 * re-use that database so the expensive ingest step only happens once.
 *
 * Usage (all CLI arguments are optional):
 *   npm run main.ts                   # uses defaults below
 *   npm run main.ts orange            # custom target, still returns 250 nearest
 *
 * Requirements:
 *   npm install sqlite-vec better-sqlite3
 *   # Or with Bun
 *   npm run add sqlite-vec better-sqlite3
 *
 *  The vector file is expected to have one word per line followed by the
 *  floating-point components, e.g.
 *    banana 0.123 -0.045 ...
 */

import * as sqliteVec from 'sqlite-vec';
import Database, { type Database as BetterSqlite3Database } from 'better-sqlite3';
import { shouldFilterAsync } from './word-utils.ts';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync } from 'fs';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const VECTOR_FILE = join(WORDS_DIR, 'dolma_300_2024_1.2M.100_combined.txt');
const DB_FILE = join(WORDS_DIR, 'vectors.sqlite');
const DEFAULT_TARGET = 'banana';

/** Build the SQLite database (if it doesn't exist yet) by streaming the
 *  vector file line-by-line and inserting every word + embedding. */
async function maybeBuildDatabase(db: BetterSqlite3Database, vectorPath: string) {
  const haveTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='words';")
    .pluck()
    .get();

  if (haveTable) return; // already built

  console.time('buildDatabase');

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE words (word TEXT PRIMARY KEY, embedding BLOB);');

  const insertStmt = db.prepare('INSERT OR IGNORE INTO words (word, embedding) VALUES (?, ?)');
  const insertTxn = db.transaction((word: string, emb: Buffer) => {
    insertStmt.run(word, emb);
  });

  const fs = await import('fs');
  const readline = await import('readline');

  const rl = readline.createInterface({
    input: fs.createReadStream(vectorPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;
  for await (const line of rl) {
    if (!line) continue;
    const [word, ...nums] = line.trim().split(/\s+/);
    if (!word || nums.length === 0) continue;
    if (await shouldFilterAsync(word)) continue;

    const floatArr = Float32Array.from(nums.map(Number));
    // Convert to a Node Buffer so SQLite stores it as a BLOB. Float32Array's
    // underlying ArrayBuffer is already little-endian and compact.
    const buf = Buffer.from(floatArr.buffer);
    insertTxn(word, buf);

    if (++lineCount % 50000 === 0) {
      // give the event-loop a breather and show progress
      console.log(`  … ingested ${lineCount.toLocaleString()} vectors`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  console.timeEnd('buildDatabase');
}

async function main() {
  const [, , rawTarget] = process.argv;
  const target = rawTarget ?? DEFAULT_TARGET;

  // Delete existing database file so it is recreated from scratch each run
  if (existsSync(DB_FILE)) {
    rmSync(DB_FILE);
  }

  const db = new Database(DB_FILE);
  sqliteVec.load(db);

  await maybeBuildDatabase(db, VECTOR_FILE);

  // Fetch the target embedding
  const targetRow = db.prepare('SELECT embedding FROM words WHERE word = ?').get(target) as {
    embedding?: Buffer;
  };

  if (!targetRow || !targetRow.embedding) {
    console.error(`Target word “${target}” not found in vocabulary.`);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
