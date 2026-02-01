#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const DEFAULT_CSV_PATH = join(ROOT_DIR, 'words', 'new', 'lemma-map-full.retried.final.csv');

function parseTopNFromArgs(): number | null {
  const raw = process.argv[2];
  if (raw === undefined || raw === null || raw === '' || raw === '--all') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 200;
  return Math.max(1, Math.floor(n));
}

async function loadCsv(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function buildWordFrequency(csv: string): Map<string, number> {
  const freq = new Map<string, number>();
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /\bword\s*,\s*lemma\b/i.test(line)) continue; // header
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const rawWord = line.slice(0, comma).trim().toLowerCase();
    if (!rawWord) continue;
    freq.set(rawWord, (freq.get(rawWord) ?? 0) + 1);
  }
  return freq;
}

async function main() {
  // Usage: new-find-most-common-words.ts [topN|--all] [csvPath]
  const [, , , /* node */ /* topArg */ csvPathArg] = process.argv;
  const topN = parseTopNFromArgs();
  const csvPath = csvPathArg && csvPathArg !== '-' ? csvPathArg : DEFAULT_CSV_PATH;

  const csv = await loadCsv(csvPath);
  const freq = buildWordFrequency(csv);

  const entries = Array.from(freq.entries());
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const reportable = entries.filter(([, count]) => count > 1);

  const totalUnique = entries.length;
  const totalRows = entries.reduce((sum, [, c]) => sum + c, 0);

  console.log(
    `Scanned ${totalRows.toLocaleString()} rows from ${csvPath}. Unique words: ${totalUnique.toLocaleString()}.`
  );
  console.log(`Most common words (highest to lowest; count > 1):`);

  const limit = topN === null ? reportable.length : Math.min(reportable.length, topN);
  for (let i = 0; i < limit; i++) {
    const [word, count] = reportable[i]!;
    console.log(`${word},${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
