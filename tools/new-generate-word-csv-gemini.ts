#!/usr/bin/env node --experimental-strip-types

import * as sqliteVec from 'sqlite-vec';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, createWriteStream, existsSync, rmSync, cpSync, readFileSync } from 'fs';
import { validateWordList } from './word-utils.ts';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, '..');
const WORDS_DIR = join(REPO_ROOT, 'words');
const NEW_DIR = join(WORDS_DIR, 'new');
const DB_FILE = join(NEW_DIR, 'new-vectors.sqlite');
const DEFAULT_WORD_LIST = join(NEW_DIR, 'word-list.txt');
const CSV_OUTPUT_DIR = join(NEW_DIR, 'words-of-the-day');
const CLIENT_CHALLENGES_DIR = join(REPO_ROOT, 'src', 'client', 'public', 'challenges');

function ensureOutputDir() {
  mkdirSync(CSV_OUTPUT_DIR, { recursive: true });
}

function cleanOutputDir() {
  if (existsSync(CSV_OUTPUT_DIR)) {
    rmSync(CSV_OUTPUT_DIR, { recursive: true, force: true });
  }
}

function syncChallengesToClientPublic() {
  if (existsSync(CLIENT_CHALLENGES_DIR)) {
    rmSync(CLIENT_CHALLENGES_DIR, { recursive: true, force: true });
  }
  mkdirSync(CLIENT_CHALLENGES_DIR, { recursive: true });
  cpSync(CSV_OUTPUT_DIR, CLIENT_CHALLENGES_DIR, { recursive: true });
}

function loadTargetWords(listPath: string): string[] {
  const raw = readFileSync(listPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((w: string) => w.trim())
    .filter((w: string) => w && !w.startsWith('#'));
}

async function main() {
  const [, , wordListArg] = process.argv;
  const wordListPath = wordListArg ?? DEFAULT_WORD_LIST;

  cleanOutputDir();

  const targets = loadTargetWords(wordListPath);
  await validateWordList(targets);
  if (targets.length === 0) {
    console.error('No words found in list file');
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
    const challengeNumber = (index + 1).toString();
    console.time(`csv:${target}`);

    const row = selectEmbeddingStmt.get(target) as { embedding?: Buffer } | undefined;
    if (!row?.embedding) {
      console.warn(`Skipping "${target}": not found in vocabulary.`);
      continue;
    }

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

    const targetLetter = target[0]?.toLowerCase();
    if (targetLetter) {
      streams.get(targetLetter)?.write(`${target},1,0\n`);
    }

    const hintStream = createWriteStream(join(challengeDir, '_hint.csv'), {
      encoding: 'utf8',
    });
    hintStream.write('word,similarity,rank\n');

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

      if (hintCount < MAX_HINTS) {
        hintStream.write(`${word},${similarity.toFixed(4)},${hintCount + 1}\n`);
        hintCount++;
      }

      rank++;
    }

    await new Promise<void>((resolve, reject) => {
      hintStream.on('finish', resolve);
      hintStream.on('error', reject);
      hintStream.end();
    });

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
  syncChallengesToClientPublic();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
