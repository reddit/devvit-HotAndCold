#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const SOWPODS_DEFAULT = join(ROOT_DIR, 'words', 'sowpods.txt');
const FINAL_WORDLIST_DEFAULT = join(ROOT_DIR, 'words-final', 'word-list.csv');
const OUTPUT_HINTS_DEFAULT = join(ROOT_DIR, 'words-final', 'hints.csv');

async function readText(path: string): Promise<string> {
  return fsp.readFile(path, 'utf8');
}

function normalizeWord(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (!/^[a-z]+$/.test(t)) return null;
  return t;
}

function parseSowpods(raw: string): Set<string> {
  const set = new Set<string>();
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const w = normalizeWord(line);
    if (w) set.add(w);
  }
  return set;
}

function parseFinalWordList(raw: string): Set<string> {
  const set = new Set<string>();
  const lines = raw.split(/\r?\n/);
  // Expect header present; tolerate absence
  let start = 0;
  if (lines.length && /^\s*word\s*$/i.test(lines[0] || '')) start = 1;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const w = normalizeWord(line.split(',')[0] || line);
    if (w) set.add(w);
  }
  return set;
}

async function writeHints(path: string, words: string[]): Promise<void> {
  const header = 'word\n';
  const body = words.join('\n');
  const trailing = words.length ? '\n' : '';
  await fsp.writeFile(path, header + body + trailing, 'utf8');
}

async function main() {
  const [, , sowpodsArg, finalListArg, outputArg] = process.argv;
  const sowpodsPath = sowpodsArg && sowpodsArg !== '-' ? sowpodsArg : SOWPODS_DEFAULT;
  const finalListPath =
    finalListArg && finalListArg !== '-' ? finalListArg : FINAL_WORDLIST_DEFAULT;
  const outputPath = outputArg && outputArg !== '-' ? outputArg : OUTPUT_HINTS_DEFAULT;

  const [sowpodsRaw, finalRaw] = await Promise.all([
    readText(sowpodsPath),
    readText(finalListPath),
  ]);

  const sowpods = parseSowpods(sowpodsRaw);
  const finalWords = parseFinalWordList(finalRaw);

  const intersection: string[] = [];
  for (const w of finalWords) {
    if (sowpods.has(w)) intersection.push(w);
  }
  intersection.sort((a, b) => a.localeCompare(b));

  await writeHints(outputPath, intersection);
  console.table({
    sowpodsCount: sowpods.size,
    finalListCount: finalWords.size,
    hintsCount: intersection.length,
    outputPath,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

