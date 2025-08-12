#!/usr/bin/env node --experimental-strip-types

/**
 * Generate similarity CSVs for a list of target words.
 *
 * For every target word provided via an input text file (one word per line),
 * create a CSV file in `./words/words-of-the-day/<word>.csv` containing **all**
 * words in the `vectors.sqlite` database, sorted by their cosine similarity to
 * the target word (highest → lowest).
 *
 * Usage (all CLI arguments are optional):
 *   npm run generate-word-csv.ts                   # uses defaults below
 *   npm run generate-word-csv.ts my-words.txt      # custom list file

 *
 * Requirements:
 *   npm install sqlite-vec better-sqlite3
 *   # Or with Bun
 *   npm run add sqlite-vec better-sqlite3
 */

import * as sqliteVec from 'sqlite-vec';
import Database from 'better-sqlite3';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, mkdirSync, createWriteStream, existsSync, rmSync, cpSync } from 'fs';
import { validateWordList } from './word-utils.ts';

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, '..');
const WORDS_DIR = join(REPO_ROOT, 'words');
const DB_FILE = join(WORDS_DIR, 'vectors.sqlite');
// Default list of target words. Expected to be a plain text file with one word
// per line.
const DEFAULT_WORD_LIST = join(WORDS_DIR, 'word-list.txt');
const CSV_OUTPUT_DIR = join(WORDS_DIR, 'words-of-the-day');
const CLIENT_CHALLENGES_DIR = join(REPO_ROOT, 'src', 'client', 'public', 'challenges');
const CLIENT_PUBLIC_DIR = join(REPO_ROOT, 'src', 'client', 'public');
const LEMMA_CSV_FILE = join(WORDS_DIR, 'lemma.csv');
const SERVER_DIR = join(REPO_ROOT, 'src', 'server');

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Ensure the root output directory exists. */
function ensureOutputDir() {
  mkdirSync(CSV_OUTPUT_DIR, { recursive: true });
}

/**
 * Delete the existing CSV output directory so each run starts fresh.
 */
function cleanOutputDir() {
  if (existsSync(CSV_OUTPUT_DIR)) {
    rmSync(CSV_OUTPUT_DIR, { recursive: true, force: true });
  }
}

/** Mirror the freshly generated challenges into the client public directory. */
function syncChallengesToClientPublic() {
  // Ensure destination is clean so it mirrors the source
  if (existsSync(CLIENT_CHALLENGES_DIR)) {
    rmSync(CLIENT_CHALLENGES_DIR, { recursive: true, force: true });
  }
  mkdirSync(CLIENT_CHALLENGES_DIR, { recursive: true });
  // Recursively copy all generated challenge CSVs
  cpSync(CSV_OUTPUT_DIR, CLIENT_CHALLENGES_DIR, { recursive: true });
}

/** Copy the word list used for generation into the server directory as well. */
function copyWordListToServer(listPath: string) {
  mkdirSync(SERVER_DIR, { recursive: true });
  cpSync(listPath, join(SERVER_DIR, 'word-list.txt'));
}

/** Copy lemma.csv to the client public directory for client access. */
function copyLemmaToClientPublic() {
  try {
    if (!existsSync(LEMMA_CSV_FILE)) return;
    mkdirSync(CLIENT_PUBLIC_DIR, { recursive: true });
    cpSync(LEMMA_CSV_FILE, join(CLIENT_PUBLIC_DIR, 'lemma.csv'));
  } catch (err) {
    console.warn('⚠️  Unable to copy lemma file to client public:', err);
  }
}

/**
 * Load and return an array of target words from the given file.
 * Lines that are empty or start with a # are ignored.
 */
function loadTargetWords(listPath: string): string[] {
  const raw = readFileSync(listPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((w) => w.trim())
    .filter((w) => w && !w.startsWith('#'));
}

// ---------------------------------------------------------------------------
// Main logic
// ---------------------------------------------------------------------------

async function main() {
  const [, , wordListArg] = process.argv;
  const wordListPath = wordListArg ?? DEFAULT_WORD_LIST;

  // Ensure output directory is fresh
  cleanOutputDir();

  const targets = loadTargetWords(wordListPath);
  // Validate target word list before proceeding
  await validateWordList(targets);
  if (targets.length === 0) {
    console.error(`No words found in list file ${basename(wordListPath)}`);
    process.exit(1);
  }

  ensureOutputDir();

  const db = new Database(DB_FILE);
  sqliteVec.load(db);

  const selectEmbeddingStmt = db.prepare('SELECT embedding FROM words WHERE word = ?');
  const similarityQuery =
    'SELECT word, 1.0 - vec_distance_cosine(embedding, ?) AS similarity FROM words WHERE word != ? ORDER BY similarity DESC';
  const similarityStmt = db.prepare(similarityQuery);

  const letters = 'abcdefghijklmnopqrstuvwxyz';

  for (const [index, target] of targets.entries()) {
    const challengeNumber = (index + 1).toString(); // 1-based index
    console.time(`csv:${target}`);

    const row = selectEmbeddingStmt.get(target) as { embedding?: Buffer } | undefined;
    if (!row?.embedding) {
      console.warn(`Skipping "${target}": not found in vocabulary.`);
      continue;
    }

    // -----------------------------------------------------------------------
    // Prepare output streams – one CSV per starting letter (a.csv, b.csv, ...)
    // -----------------------------------------------------------------------
    const challengeDir = join(CSV_OUTPUT_DIR, challengeNumber);
    mkdirSync(challengeDir, { recursive: true });

    const streams = new Map<string, ReturnType<typeof createWriteStream>>();
    for (const letter of letters) {
      const stream = createWriteStream(join(challengeDir, `${letter}.csv`), {
        encoding: 'utf8',
      });
      stream.write('word,similarity,rank\n');
      streams.set(letter, stream);
    }

    // Ensure the target word itself is present with similarity 1.0000 in its
    // corresponding file so users can guess it.
    const targetLetter = target[0]?.toLowerCase();
    if (targetLetter) {
      streams.get(targetLetter)?.write(`${target},1,0\n`);
    }

    // -----------------------------------------------------------------------
    // Create hint CSV with top 500 guesses
    // -----------------------------------------------------------------------
    const hintStream = createWriteStream(join(challengeDir, '_hint.csv'), {
      encoding: 'utf8',
    });
    hintStream.write('word,similarity,rank\n');
    // Note: Do not include the target word itself in the hint list

    // -----------------------------------------------------------------------
    // Stream the similarity results, bucketising by first letter and collecting top 500 for hints
    // -----------------------------------------------------------------------
    let hintCount = 0;
    let rank = 0;
    const MAX_HINTS = 500;

    for (const { word, similarity } of similarityStmt.iterate(
      row.embedding,
      target
    ) as IterableIterator<any>) {
      const letter = word[0]?.toLowerCase();
      const stream = streams.get(letter);
      if (stream) {
        stream.write(`${word},${similarity.toFixed(4)},${rank + 1}\n`);
      }

      // Add to hint CSV (top 500 only)
      if (hintCount < MAX_HINTS) {
        hintStream.write(`${word},${similarity.toFixed(4)},${hintCount + 1}\n`);
        hintCount++;
      }

      rank++;
    }

    // Close hint stream
    await new Promise<void>((resolve, reject) => {
      hintStream.on('finish', resolve);
      hintStream.on('error', reject);
      hintStream.end();
    });

    // -----------------------------------------------------------------------
    // Flush all streams before moving on to the next challenge word
    // -----------------------------------------------------------------------
    await Promise.all(
      Array.from(streams.values()).map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.on('finish', resolve);
            s.on('error', reject);
            s.end();
          })
      )
    );

    console.timeEnd(`csv:${target}`);
  }

  db.close();
  // Allow Node to exit naturally after all I/O is flushed

  // -------------------------------------------------------------------------
  // Post-processing copies
  // - Mirror the generated CSVs to `src/client/public/challenges`
  // - Copy the word-list.txt to `src/server`
  // - Copy lemma.csv to `src/client/public/lemma.csv`
  // -------------------------------------------------------------------------
  syncChallengesToClientPublic();
  copyWordListToServer(wordListPath);
  copyLemmaToClientPublic();

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
