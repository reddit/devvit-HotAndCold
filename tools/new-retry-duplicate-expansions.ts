#!/usr/bin/env node --experimental-strip-types

import OpenAI from 'openai';
import { promises as fsp } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import PQueue from 'p-queue';

import { getOpenAIKey, getVariantsFromOpenAI } from './openai-variants.ts';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const WORDS_NEW_DIR = join(ROOT_DIR, 'words', 'new');
const DEFAULT_CSV_PATH = join(WORDS_NEW_DIR, 'lemma-map-full.csv');

type Row = { word: string; lemma: string };

async function loadCsv(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function parseRows(csv: string): Row[] {
  const rows: Row[] = [];
  const lines = csv.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (i === 0 && /\bword\s*,\s*lemma\b/i.test(line)) continue; // header
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const word = line.slice(0, comma).trim().toLowerCase();
    const lemma = line
      .slice(comma + 1)
      .trim()
      .toLowerCase();
    if (!word || !lemma) continue;
    rows.push({ word, lemma });
  }
  return rows;
}

function buildFrequency(rows: Row[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const r of rows) {
    freq.set(r.word, (freq.get(r.word) ?? 0) + 1);
  }
  return freq;
}

function buildWordToLemmas(rows: Row[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const { word, lemma } of rows) {
    let set = map.get(word);
    if (!set) {
      set = new Set<string>();
      map.set(word, set);
    }
    set.add(lemma);
  }
  return map;
}

async function writeCsv(path: string, header: string, rows: Row[]): Promise<void> {
  const out = [header, ...rows.map((r) => `${r.word},${r.lemma}`)].join('\n') + '\n';
  await fsp.writeFile(path, out, 'utf8');
}

async function appendRows(path: string, rows: Row[]): Promise<void> {
  if (rows.length === 0) return;
  const out = rows.map((r) => `${r.word},${r.lemma}`).join('\n') + '\n';
  await fsp.appendFile(path, out, 'utf8');
}

// getOpenAIKey now imported from './openai-variants.ts'

function dedupe<T>(arr: Iterable<T>): T[] {
  return Array.from(new Set(arr));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveCsvPath(csvPathArg: string | undefined): Promise<string> {
  const candidates: string[] = [];
  if (csvPathArg && csvPathArg !== '-') candidates.push(csvPathArg);
  candidates.push(
    DEFAULT_CSV_PATH,
    join(ROOT_DIR, 'lemma-map-full.csv'),
    join(ROOT_DIR, 'words', 'lemma-map-full.csv'),
    join(WORDS_NEW_DIR, 'lemma-map-full.cleaned.csv')
  );
  for (const p of candidates) {
    if (await pathExists(p)) return p;
  }
  throw new Error(
    `Could not find lemma map CSV. Tried:\n${candidates.join('\n')}\nPass a path argument to override.`
  );
}

async function backupFile(path: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.backup.${ts}`;
  await fsp.copyFile(path, backupPath);
  return backupPath;
}

async function rewriteCsvSafely(path: string, header: string, rows: Row[]): Promise<void> {
  const tmpPath = `${path}.tmp`;
  const backupPath = await backupFile(path);
  await writeCsv(tmpPath, header, rows);
  await fsp.rename(tmpPath, path);
  console.log(`Created backup at ${backupPath}`);
}

function parseFlags(argv: string[]): { inPlace: boolean; outputPathArg: string | null } {
  let inPlace = false;
  let outputPathArg: string | null = null;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i] || '';
    if (a === '--in-place' || a === '-i') inPlace = true;
    else if (a === '--output' || a === '-o') {
      outputPathArg = argv[i + 1] || null;
      i++;
    } else if (a.startsWith('--output=')) {
      outputPathArg = a.slice('--output='.length);
    }
  }
  return { inPlace, outputPathArg };
}

async function ensureDirForFile(path: string): Promise<void> {
  const dir = dirname(path);
  await fsp.mkdir(dir, { recursive: true });
}

async function main() {
  // Usage: new-retry-duplicate-expansions.ts [csvPath]
  const { inPlace, outputPathArg } = parseFlags(process.argv);
  // First non-flag arg can still be a csv path for backward compatibility
  const rawCsvArg =
    process.argv[2] && !process.argv[2]!.startsWith('-') ? process.argv[2] : undefined;
  const csvPath = await resolveCsvPath(rawCsvArg);
  const nameNoExt = basename(csvPath).replace(/\.csv$/i, '');
  const defaultOutputPath = join(WORDS_NEW_DIR, `${nameNoExt}.retried.csv`);
  const outputPath = inPlace ? csvPath : outputPathArg || defaultOutputPath;

  const concurrency = Math.max(1, Number(process.env.CLEAN_CONCURRENCY) || 20);
  const rps = Number.isFinite(Number(process.env.CLEAN_RPS)) ? Number(process.env.CLEAN_RPS) : 20;

  const header = 'word,lemma';

  const csv = await loadCsv(csvPath);
  const rows = parseRows(csv);
  if (rows.length === 0) {
    console.log(`No data rows in ${csvPath}. Nothing to retry.`);
    return;
  }

  const freq = buildFrequency(rows);
  const wordToLemmas = buildWordToLemmas(rows);

  const duplicates: Array<{ word: string; count: number; lemmas: string[] }> = [];
  for (const [word, count] of freq.entries()) {
    if (count > 1) {
      const lemmas = dedupe(wordToLemmas.get(word) ?? []);
      duplicates.push({ word, count, lemmas });
    }
  }

  if (duplicates.length === 0) {
    console.log('No duplicate expansions found. Nothing to retry.');
    return;
  }

  duplicates.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  for (const d of duplicates) {
    console.log(`found due to ${d.word} being in the file ${d.count} times`);
  }

  const lemmasToRetry = dedupe(duplicates.flatMap((d) => d.lemmas));
  console.log(`Total lemmas to retry: ${lemmasToRetry.length.toLocaleString()}`);

  // Remove all expansions from these lemmas
  const filteredRows = rows.filter((r) => !lemmasToRetry.includes(r.lemma));
  if (outputPath === csvPath) {
    await rewriteCsvSafely(csvPath, header, filteredRows);
    console.log(
      `Removed expansions for ${lemmasToRetry.length.toLocaleString()} lemmas. File rewritten in-place.`
    );
  } else {
    await ensureDirForFile(outputPath);
    await writeCsv(outputPath, header, filteredRows);
    console.log(
      `Removed expansions for ${lemmasToRetry.length.toLocaleString()} lemmas. Wrote filtered copy to ${outputPath}.`
    );
  }

  const client = new OpenAI({ apiKey: getOpenAIKey() });
  const queue = new PQueue({
    concurrency,
    ...(rps
      ? { intervalCap: Math.max(1, rps), interval: 1000, carryoverConcurrencyCount: true }
      : {}),
  });

  let processed = 0;
  let written = 0;

  const tasks: Promise<unknown>[] = [];
  for (const lemma of lemmasToRetry) {
    tasks.push(
      queue.add(async () => {
        try {
          const { tokens } = await getVariantsFromOpenAI(client, lemma);
          if (tokens.length === 0) {
            console.log(`[retry] ${lemma}: no expansions`);
            return;
          }
          const pairs: Row[] = tokens.map((t) => ({
            word: t.toLowerCase(),
            lemma: lemma.toLowerCase(),
          }));
          await appendRows(outputPath, pairs);
          written += pairs.length;
          console.log(`[retry] retried ${lemma}`);
        } finally {
          processed++;
          if (processed % 50 === 0 || processed === lemmasToRetry.length) {
            console.log(
              `  … retried ${processed}/${lemmasToRetry.length} (rows appended≈${written})`
            );
          }
        }
      })
    );
  }

  await Promise.all(tasks);
  await queue.onIdle();
  console.log('Duplicate expansions retry complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
