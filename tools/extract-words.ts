#!/usr/bin/env node --experimental-strip-types

/**
 * Extract only the vocabulary words (one per line) from a plain-text
 * word-embedding / GloVe-style vector file. Each line of the input file is
 * expected to start with a single token (the word) followed by one or more
 * whitespace-separated floating-point numbers (the vector components).
 *
 * The script streams the input file line-by-line so it can handle very large
 * files without excessive memory usage. The extracted words are written to the
 * output file *in the same order* as they appear in the input.
 *
 * Usage (CLI arguments are optional):
 *   npm run extract-words.ts                       # uses defaults below
 *   npm run extract-words.ts vectors.txt           # custom input file, auto output
 *   npm run extract-words.ts vectors.txt words.txt # custom input & output paths
 *
 * Defaults:
 *   • INPUT  = ./dolma_300_2024_1.2M.100_combined.txt
 *   • OUTPUT = <input_basename>.words.txt  (e.g. vectors.txt → vectors.words.txt)
 */

import { createReadStream, createWriteStream } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const DEFAULT_INPUT = join(WORDS_DIR, 'dolma_300_2024_1.2M.100_combined.txt');

function defaultOutputPath(inputPath: string) {
  const base = basename(inputPath);
  return join(WORDS_DIR, `${base}.words.txt`);
}

async function extractWords(input: string, output: string) {
  const rl = createInterface({
    input: createReadStream(input, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  const out = createWriteStream(output, { encoding: 'utf8' });

  let count = 0;
  for await (const line of rl) {
    if (!line) continue;
    const spaceIdx = line.indexOf(' ');
    const word = spaceIdx === -1 ? line.trim() : line.slice(0, spaceIdx);
    if (!word) continue;

    out.write(word + '\n');

    if (++count % 100000 === 0) {
      // Show progress for huge files without slowing the stream too much
      console.log(`  … processed ${count.toLocaleString()} lines`);
    }
  }

  out.end();
  await new Promise<void>((resolve) => out.once('finish', () => resolve()));

  console.log(`\n✅  Wrote ${count.toLocaleString()} words to ${output}`);
}

async function main() {
  const [, , rawInput, rawOutput] = process.argv;
  const input = rawInput ?? DEFAULT_INPUT;
  const output = rawOutput ?? defaultOutputPath(input);

  console.time('extract');
  await extractWords(input, output);
  console.timeEnd('extract');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
