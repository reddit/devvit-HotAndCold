#!/usr/bin/env node --experimental-strip-types
/**
 * Scan a plain-text file and report whether a target word occurs at least once.
 *
 * Usage (CLI arguments are optional):
 *   npm run find-word.ts                # uses defaults below
 *   npm run find-word.ts orange         # custom word, default file
 *   npm run find-word.ts orange data.txt  # custom word AND file
 *
 * The scan is case-sensitive; tweak the regex if you want case-insensitive.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_WORD = 'banana';
const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const DEFAULT_FILE = join(WORDS_DIR, 'dolma_300_2024_1.2M.100_combined.txt');

async function wordExistsInFile(target: string, filePath: string): Promise<boolean> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  // Compile a quick RegExp once so we don’t allocate per line
  const pattern = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

  for await (const line of rl) {
    if (pattern.test(line)) {
      rl.close(); // stop reading early
      return true;
    }
  }
  return false;
}

async function main() {
  const [, , rawWord, rawFile] = process.argv;
  const word = rawWord ?? DEFAULT_WORD;
  const file = rawFile ?? DEFAULT_FILE;

  console.time('search');
  const found = await wordExistsInFile(word, file);
  console.timeEnd('search');

  console.log(
    found
      ? `✅  Word “${word}” WAS found in ${file}`
      : `❌  Word “${word}” was NOT found in ${file}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
