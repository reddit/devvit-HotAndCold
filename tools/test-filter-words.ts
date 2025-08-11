#!/usr/bin/env node --experimental-strip-types

import { createReadStream, createWriteStream, promises as fsp } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { filters } from './word-utils.ts';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const DEFAULT_INPUT = join(WORDS_DIR, 'dolma_300_2024_1.2M.100_combined.txt');
const DEFAULT_OUT_DIR = join(WORDS_DIR, 'filter-results');

async function main() {
  const [, , rawInput, rawOutDir] = process.argv;
  const inputPath = rawInput ?? DEFAULT_INPUT;
  const outDir = rawOutDir ?? DEFAULT_OUT_DIR;

  // Ensure a clean output directory for each run
  await fsp.rm(outDir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(outDir, { recursive: true });
  const filtersDir = join(outDir, 'filters');
  await fsp.mkdir(filtersDir, { recursive: true });

  // Prepare per-filter write streams & counters
  type Stats = { input: number; kept: number };
  const stats: Record<string, Stats> = {};
  const streams: Record<string, ReturnType<typeof createWriteStream>> = {};

  for (const f of filters) {
    stats[f.name] = { input: 0, kept: 0 }; // input will be filled after pass
    streams[f.name] = createWriteStream(join(filtersDir, `${f.name}.txt`), {
      encoding: 'utf8',
    });
  }

  // Unmatched bucket
  stats['unmatched'] = { input: 0, kept: 0 };
  streams['unmatched'] = createWriteStream(join(outDir, `final.txt`), {
    encoding: 'utf8',
  });

  const rl = createInterface({
    input: createReadStream(inputPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let lineCount = 0;

  for await (const line of rl) {
    const word = line.trim().split(/\s+/)[0];
    if (!word) continue;
    lineCount++;

    let matched = false;
    for (const f of filters) {
      stats[f.name]!.input++; // the word has reached this filter
      if (await Promise.resolve(f.fn(word))) {
        stats[f.name]!.kept++;
        streams[f.name]!.write(word + '\n');
        matched = true;
        break; // stop checking further filters once matched
      }
    }

    if (!matched) {
      streams['unmatched'].write(word + '\n');
      stats['unmatched']!.kept++;
    }

    if (lineCount % 200000 === 0) {
      console.log(`… processed ${lineCount.toLocaleString()} words`);
    }
  }

  // Close streams
  await Promise.all(
    Object.values(streams).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.end();
          s.on('finish', () => resolve());
        })
    )
  );

  // -----------------------------------------------------------------------
  // 3️⃣  Reporting
  // -----------------------------------------------------------------------

  const totalWords = lineCount;
  const table = [] as Array<Record<string, string>>;
  let totalFiltered = 0;
  for (const f of filters) {
    const { kept } = stats[f.name]!;
    totalFiltered += kept;
    table.push({
      Filter: f.name,
      Filtered: kept.toLocaleString(),
      '% of Total': ((kept / totalWords) * 100).toFixed(2) + '%',
    });
  }

  console.log('\nSummary statistics (per-filter):\n--------------------------------');
  console.table(table);

  const unmatched = stats['unmatched']!.kept;
  console.log(
    'Unmatched (written to final.txt):',
    unmatched.toLocaleString(),
    `(${((unmatched / totalWords) * 100).toFixed(2)}%)`
  );

  console.log(
    `\nOverall filtered: ${totalFiltered.toLocaleString()} / ${totalWords.toLocaleString()} (${(
      (totalFiltered / totalWords) *
      100
    ).toFixed(2)}%)`
  );

  console.log(`\n✅  Finished. Outputs are in: ${outDir}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
