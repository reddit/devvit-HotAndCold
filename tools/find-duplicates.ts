#!/usr/bin/env node --experimental-strip-types
/**
 * Scan a plain-text file, count every word and report all that occur more than once (duplicates).
 *
 * Usage (CLI arguments are optional):
 *   npm run find-duplicates.ts                       # uses defaults below, prints top 100 duplicates
 *   npm run find-duplicates.ts data.txt              # custom file, prints top 100 duplicates
 *   npm run find-duplicates.ts data.txt 50           # custom file, print top 50 duplicates
 *
 * Notes:
 *  • The definition of a "word" here is any run of non-whitespace characters separated by /\s+/.
 *    Adjust the tokenizer if your dataset needs more nuance.
 *  • Counting is case-sensitive. Use .toLowerCase() inside the loop if you want case-insensitive.
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const DEFAULT_FILE = join(WORDS_DIR, 'dolma_300_2024_1.2M.100_combined.txt');
const DEFAULT_TOP_N = 100;

async function collectDuplicateCounts(filePath: string): Promise<Map<string, number>> {
  // `seen` tracks words we've encountered exactly once so far.
  // `dupes` tracks words we've seen 2+ times along with their counts.
  const seen = new Set<string>();
  const dupes = new Map<string, number>();

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    // Extract only the first token on each line (faster + less memory for vector files).
    const spaceIdx = line.indexOf(' ');
    const raw = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    if (!raw) continue; // skip empty tokens
    const word = raw; // case‐sensitive; change to raw.toLowerCase() if desired

    if (dupes.has(word)) {
      dupes.set(word, dupes.get(word)! + 1);
    } else if (seen.has(word)) {
      // Second time we've seen this word → move from `seen` to `dupes` with count = 2
      seen.delete(word);
      dupes.set(word, 2);
    } else {
      seen.add(word);
    }
  }

  return dupes;
}

async function main() {
  const [, , rawFile, rawTopN] = process.argv;
  const file = rawFile ?? DEFAULT_FILE;
  const topN = rawTopN ? Number(rawTopN) : DEFAULT_TOP_N;

  if (Number.isNaN(topN) || topN <= 0) {
    console.error(`Invalid top-N value: ${rawTopN}`);
    process.exit(1);
  }

  console.time('scan');
  const duplicates = await collectDuplicateCounts(file);
  console.timeEnd('scan');

  const sorted = Array.from(duplicates.entries()).sort((a, b) => b[1] - a[1]);

  console.log(`Duplicate words (=occur > 1): ${duplicates.size}`);
  console.log('\nTop duplicates:\n----------------');

  for (const [word, count] of sorted.slice(0, topN)) {
    console.log(`${count.toString().padStart(8)}  ${word}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
