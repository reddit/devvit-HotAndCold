#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const DEFAULT_CSV_PATH = join(ROOT_DIR, 'words', 'new', 'lemma-map-full.csv');

type LemmaToVariants = Map<string, Set<string>>;

function parseMinThresholdFromArgs(): number {
  const raw = process.argv[2];
  const env = process.env.MIN_NON_LEMMA_VARIANTS;
  const n = Number.isFinite(Number(raw))
    ? Number(raw)
    : Number.isFinite(Number(env))
      ? Number(env)
      : 8;
  return Math.max(0, Math.floor(n));
}

async function loadCsv(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function buildLemmaIndex(csv: string): LemmaToVariants {
  const map: LemmaToVariants = new Map();
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /^\s*word\s*,\s*lemma\s*$/i.test(line)) continue;
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const word = line.slice(0, comma).trim().toLowerCase();
    const lemma = line
      .slice(comma + 1)
      .trim()
      .toLowerCase();
    if (!word || !lemma) continue;
    if (word === lemma) continue; // Skip lemma==word just in case
    let set = map.get(lemma);
    if (!set) {
      set = new Set<string>();
      map.set(lemma, set);
    }
    set.add(word);
  }
  return map;
}

function formatEntry(lemma: string, variants: string[]): string {
  return `${lemma} (${variants.length}): ${variants.join(', ')}`;
}

async function main() {
  const csvPathArg = process.argv[3];
  const csvPath = csvPathArg && csvPathArg !== '-' ? csvPathArg : DEFAULT_CSV_PATH;
  const minVariants = parseMinThresholdFromArgs();

  const csv = await loadCsv(csvPath);
  const index = buildLemmaIndex(csv);

  const results: Array<{ lemma: string; variants: string[] }> = [];
  for (const [lemma, set] of index) {
    if (set.size > minVariants) {
      const variants = Array.from(set).sort();
      results.push({ lemma, variants });
    }
  }

  results.sort((a, b) => b.variants.length - a.variants.length || a.lemma.localeCompare(b.lemma));

  console.log(
    `Scanning ${index.size.toLocaleString()} lemmas from ${csvPath}. Threshold: > ${minVariants} non-lemma variants. Found: ${results.length.toLocaleString()}.`
  );
  for (const r of results) {
    console.log(formatEntry(r.lemma, r.variants));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
