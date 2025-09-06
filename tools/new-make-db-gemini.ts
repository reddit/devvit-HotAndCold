#!/usr/bin/env node --experimental-strip-types

import * as sqliteVec from 'sqlite-vec';
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createReadStream, existsSync, rmSync, readFileSync } from 'fs';
import { createInterface } from 'readline';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const CSV_FILE = join(WORDS_NEW_DIR, 'gemini_3072_embeddings.csv');
const DB_FILE = join(WORDS_NEW_DIR, 'new-vectors.sqlite');
const WORDS_FINAL_FILE = join(TOOLS_DIR, '..', 'words-final', 'word-list.csv');

function unquoteCsvField(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    // Unescape doubled quotes per CSV rules
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function parseCsvLine(line: string): { word: string; values: number[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Skip header if present
  if (/^(word|text)\s*,/i.test(trimmed)) return null;

  const firstComma = trimmed.indexOf(',');
  if (firstComma === -1) return null;
  const word = unquoteCsvField(trimmed.slice(0, firstComma));
  const rest = trimmed.slice(firstComma + 1).trim();

  if (!word) return null;

  // Handle case: second column is a JSON array, possibly quoted as a CSV field
  let values: number[] | null = null;
  let arrayText = rest;
  if (arrayText.startsWith('"') && arrayText.endsWith('"')) {
    arrayText = unquoteCsvField(arrayText);
  }
  if (arrayText.startsWith('[') && arrayText.endsWith(']')) {
    try {
      const arr = JSON.parse(arrayText);
      if (Array.isArray(arr) && arr.every((v) => typeof v === 'number')) {
        values = arr as number[];
      } else if (Array.isArray(arr) && arr.every((v) => typeof v === 'string')) {
        // Some exporters write numbers as strings
        const nums = arr.map((v) => Number(v));
        if (nums.every((n) => Number.isFinite(n))) values = nums;
      }
    } catch {
      // fall through to simple CSV parsing
    }
  }

  // Fallback: assume simple CSV with many numeric columns
  if (values == null) {
    const parts = rest.split(',');
    if (parts.length < 2) return null;
    const nums = parts.map((p) => Number(p));
    if (!nums.every((n) => Number.isFinite(n))) return null;
    values = nums;
  }

  return { word, values };
}

async function main() {
  // Fresh DB each run
  if (existsSync(DB_FILE)) rmSync(DB_FILE);

  const db = new Database(DB_FILE);
  sqliteVec.load(db);

  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE words (word TEXT PRIMARY KEY, embedding BLOB);');

  const insertStmt = db.prepare('INSERT OR REPLACE INTO words (word, embedding) VALUES (?, ?)');
  const insertTxn = db.transaction((word: string, emb: Buffer) => {
    insertStmt.run(word, emb);
  });

  // Load master word list and filter to only include those words
  const masterWords = (() => {
    const set = new Set<string>();
    const content = readFileSync(WORDS_FINAL_FILE, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || /^word$/i.test(t)) continue; // skip header/blank
      // If the file ever gains more columns, only take the first
      const firstCommaIdx = t.indexOf(',');
      const w = firstCommaIdx === -1 ? t : t.slice(0, firstCommaIdx);
      const unquoted = unquoteCsvField(w);
      if (unquoted) set.add(unquoted);
    }
    return set;
  })();

  const rl = createInterface({
    input: createReadStream(CSV_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  let count = 0;
  let dim: number | null = null;
  for await (const line of rl) {
    const parsed = parseCsvLine(line);
    if (!parsed) continue;
    if (!masterWords.has(parsed.word)) continue; // filter out words not in master list
    if (dim == null) dim = parsed.values.length;
    if (parsed.values.length !== dim) continue; // skip malformed rows

    const f32 = Float32Array.from(parsed.values);
    const buf = Buffer.from(f32.buffer);
    insertTxn(parsed.word, buf);

    if (++count % 50000 === 0) {
      console.log(`  … inserted ${count.toLocaleString()} rows`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  console.log(`✅ Built ${DB_FILE} with ${count.toLocaleString()} vectors (dim=${dim ?? 0})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
