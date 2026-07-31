#!/usr/bin/env node --experimental-strip-types

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import pg from 'pg';
import PQueue from 'p-queue';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TOOLS_DIR, '..');
const COMPOSE_FILE = join(REPO_ROOT, 'docker-compose.word-data.yml');
const EMBEDDINGS_FILE = join(REPO_ROOT, 'words-final', 'gemini_3072_embeddings.csv');
const WORD_LIST_FILE = join(REPO_ROOT, 'words-final', 'word-list.csv');
const HINT_LIST_FILE = join(REPO_ROOT, 'words-final', 'hints.csv');
const DEFAULT_TARGETS_FILE = join(REPO_ROOT, 'historical-words.csv');
const LEGACY_BASELINE_DIR = join(REPO_ROOT, 'word-data', 'v1');
const DEFAULT_OUTPUT_DIR = join(REPO_ROOT, 'word-data', 'v1');

const MAGIC = 'HCW2';
const HEADER_BYTES = 12;
const EXACT_RECORD_BYTES = 10;
const QUANTIZED_RECORD_BYTES = 4;
const SIMILARITY_SCALE = 10_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_EXACT_COUNT = 2500;
const POSTGRES_PASSWORD = 'hotandcold-local';
const POSTGRES_USER = 'hotandcold';
const POSTGRES_DB = 'hotandcold';

type Options = {
  targetsFile: string;
  baselineDir: string;
  outputDir: string;
  concurrency: number;
  limit?: number;
  force: boolean;
  keepDatabaseRunning: boolean;
  rebuildDatabase: boolean;
};

type BaselineRow = {
  word: string;
  similarityText: string;
  similarity: number;
  rank: number;
  isHint: boolean;
};

type RankedRow = {
  word: string;
  similarity: number;
  is_hint: boolean;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    targetsFile: DEFAULT_TARGETS_FILE,
    baselineDir: '',
    outputDir: DEFAULT_OUTPUT_DIR,
    concurrency: DEFAULT_CONCURRENCY,
    force: false,
    keepDatabaseRunning: false,
    rebuildDatabase: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = argv[index + 1];
    if (arg === '--targets' && value) (options.targetsFile = resolve(value)), index++;
    else if (arg === '--baseline' && value) (options.baselineDir = resolve(value)), index++;
    else if (arg === '--output' && value) (options.outputDir = resolve(value)), index++;
    else if (arg === '--concurrency' && value)
      (options.concurrency = Math.max(1, Number.parseInt(value, 10))), index++;
    else if (arg === '--limit' && value)
      (options.limit = Math.max(1, Number.parseInt(value, 10))), index++;
    else if (arg === '--force') options.force = true;
    else if (arg === '--keep-database-running') options.keepDatabaseRunning = true;
    else if (arg === '--rebuild-database') options.rebuildDatabase = true;
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!Number.isFinite(options.concurrency)) throw new Error('Invalid --concurrency value');
  return options;
}

function runDocker(args: string[], quiet = false): string {
  return execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'pipe', 'inherit'],
  }).trim();
}

function requireFile(path: string, label: string): void {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;
    if (char === '"') {
      if (quoted && line[index + 1] === '"') (field += '"'), index++;
      else quoted = !quoted;
    } else if (char === ',' && !quoted) fields.push(field), (field = '');
    else field += char;
  }
  if (quoted) throw new Error(`Unterminated CSV row: ${line.slice(0, 80)}`);
  fields.push(field);
  return fields;
}

function loadOneColumnCsv(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(1).map((line) => parseCsvRow(line)[0]!.trim().toLowerCase());
}

function uniqueInOrder(words: string[]): string[] {
  return [...new Set(words.filter(Boolean))];
}

function loadTargets(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error(`No targets found in ${path}`);
  const header = parseCsvRow(lines[0]!).map((value) => value.toLowerCase());
  const wordIndex = header.findIndex((value) => value.includes('word'));
  if (wordIndex < 0) throw new Error(`No word column found in ${path}`);
  return uniqueInOrder(
    lines.slice(1).map((line) => parseCsvRow(line)[wordIndex]?.trim().toLowerCase() ?? '')
  );
}

function loadCsvBaseline(path: string, target: string): BaselineRow[] {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean);
  if (lines[0] !== 'word,similarity,rank,isHint') {
    throw new Error(`Unexpected baseline header for ${target}`);
  }
  const rows = lines.slice(1).map((line): BaselineRow => {
    const [word, similarityText, rankText, hintText] = parseCsvRow(line);
    return {
      word: word!.trim().toLowerCase(),
      similarityText: similarityText!,
      similarity: Number(similarityText),
      rank: Number(rankText),
      isHint: hintText === 'true',
    };
  });
  if (rows[0]?.word !== target || rows[0]?.rank !== 0 || rows[0]?.similarity !== 1) {
    throw new Error(`Invalid rank-0 baseline row for ${target}`);
  }
  if (rows.length !== DEFAULT_EXACT_COUNT + 1) {
    throw new Error(`Expected ${DEFAULT_EXACT_COUNT} baseline neighbors for ${target}`);
  }
  return rows.slice(1);
}

function loadBinaryBaseline(
  baselineDir: string,
  target: string,
  dictionary: readonly string[],
  hintWords: ReadonlySet<string>
): BaselineRow[] {
  const bytes = gunzipSync(readFileSync(join(baselineDir, wordFileName(target))));
  if (bytes.toString('ascii', 0, 4) !== MAGIC) {
    throw new Error(`Unsupported binary baseline for ${target}`);
  }
  const secretId = bytes.readUInt16LE(8);
  const exactCount = bytes.readUInt16LE(10);
  if (dictionary[secretId] !== target || exactCount !== DEFAULT_EXACT_COUNT) {
    throw new Error(`Invalid binary baseline header for ${target}`);
  }
  const rows: BaselineRow[] = [];
  let offset = HEADER_BYTES;
  for (let index = 0; index < exactCount; index++) {
    const word = dictionary[bytes.readUInt16LE(offset)];
    const similarity = bytes.readDoubleLE(offset + 2);
    if (!word) throw new Error(`Invalid binary baseline word ID for ${target}`);
    rows.push({
      word,
      similarity,
      similarityText: String(similarity),
      rank: index + 1,
      isHint: hintWords.has(word),
    });
    offset += EXACT_RECORD_BYTES;
  }
  return rows;
}

function loadBaseline(
  baselineDir: string,
  target: string,
  dictionary: readonly string[],
  hintWords: ReadonlySet<string>
): BaselineRow[] {
  const csvPath = join(baselineDir, `${target}.csv`);
  return existsSync(csvPath)
    ? loadCsvBaseline(csvPath, target)
    : loadBinaryBaseline(baselineDir, target, dictionary, hintWords);
}

function wordFileName(word: string): string {
  return `${encodeURIComponent(word).replaceAll("'", '%27')}.bin.gz`;
}

function encodeTarget(
  target: string,
  rows: RankedRow[],
  baseline: BaselineRow[],
  wordIds: ReadonlyMap<string, number>
): Buffer {
  const secretId = wordIds.get(target);
  if (secretId == null) throw new Error(`Target is missing from dictionary: ${target}`);
  if (rows.length !== wordIds.size - 1) {
    throw new Error(`${target} returned ${rows.length} neighbors; expected ${wordIds.size - 1}`);
  }

  // The first 25 are the compatibility gate requested for this migration.
  // Preserve all 2,500 exported rows below, including historical approximate-
  // index ordering, then append every word the old export omitted.
  for (let index = 0; index < 25; index++) {
    const expected = baseline[index]!;
    const actual = rows[index]!;
    if (actual.word !== expected.word) {
      throw new Error(
        `${target} rank ${index + 1} mismatch: expected ${expected.word}, received ${actual.word}`
      );
    }
    // The edge function's JSON serializer occasionally emitted one fewer final
    // decimal than node-postgres for the same pgvector float8 (for example
    // 0.871391475200653 vs 0.8713914752006531). Preserve the exported value in
    // the file, while requiring the regenerated pgvector value to agree well
    // below any observable four-decimal gameplay precision.
    if (Math.abs(actual.similarity - expected.similarity) > 1e-12) {
      throw new Error(
        `${target} rank ${index + 1} similarity mismatch for ${actual.word}: ` +
          `expected ${expected.similarityText}, received ${String(actual.similarity)}`
      );
    }
  }

  const rowsByWord = new Map(rows.map((row) => [row.word, row]));
  for (const expected of baseline) {
    const actual = rowsByWord.get(expected.word);
    if (!actual) throw new Error(`${target} baseline word is missing locally: ${expected.word}`);
    if (actual.is_hint !== expected.isHint) {
      throw new Error(`${target} hint mismatch for ${expected.word}`);
    }
  }
  const baselineWords = new Set(baseline.map((row) => row.word));
  const orderedRows: RankedRow[] = [
    ...baseline.map((row) => ({
      word: row.word,
      similarity: row.similarity,
      is_hint: row.isHint,
    })),
    ...rows.filter((row) => !baselineWords.has(row.word)),
  ];

  const exactCount = baseline.length;
  const bytes = Buffer.allocUnsafe(
    HEADER_BYTES +
      exactCount * EXACT_RECORD_BYTES +
      (orderedRows.length - exactCount) * QUANTIZED_RECORD_BYTES
  );
  bytes.write(MAGIC, 0, 'ascii');
  bytes.writeUInt32LE(orderedRows.length, 4);
  bytes.writeUInt16LE(secretId, 8);
  bytes.writeUInt16LE(exactCount, 10);

  let offset = HEADER_BYTES;
  for (let index = 0; index < orderedRows.length; index++) {
    const row = orderedRows[index]!;
    const wordId = wordIds.get(row.word);
    if (wordId == null) throw new Error(`Ranked word is missing from dictionary: ${row.word}`);
    bytes.writeUInt16LE(wordId, offset);
    if (index < exactCount) {
      bytes.writeDoubleLE(baseline[index]!.similarity, offset + 2);
      offset += EXACT_RECORD_BYTES;
    } else {
      const quantized = Math.max(
        -SIMILARITY_SCALE,
        Math.min(SIMILARITY_SCALE, Math.round(row.similarity * SIMILARITY_SCALE))
      );
      bytes.writeInt16LE(quantized, offset + 2);
      offset += QUANTIZED_RECORD_BYTES;
    }
  }
  return bytes;
}

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= 90; attempt++) {
    try {
      const status = runDocker(
        ['exec', '-T', 'pgvector', 'pg_isready', '-U', POSTGRES_USER, '-d', POSTGRES_DB],
        true
      );
      if (status.includes('accepting connections')) return;
    } catch {
      // Container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for the pgvector container');
}

async function prepareDatabase(client: pg.Client, rebuild: boolean): Promise<void> {
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  const relation = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.words')::text table_name"
  );
  if (!rebuild && relation.rows[0]?.table_name) {
    const existing = await client.query<{ count: number }>('SELECT count(*)::int count FROM words');
    if (existing.rows[0]?.count === 64_639) {
      console.log('Using the existing 64,639-word local pgvector index.');
      return;
    }
  }

  console.log('Loading the local pgvector index from words-final (first run only)...');
  await client.query(`
    DROP TABLE IF EXISTS words;
    DROP TABLE IF EXISTS embedding_import;
    DROP TABLE IF EXISTS word_import;
    DROP TABLE IF EXISTS hint_import;
    CREATE UNLOGGED TABLE embedding_import (word text, embedding_text text);
    CREATE UNLOGGED TABLE word_import (word text);
    CREATE UNLOGGED TABLE hint_import (word text);
    COPY embedding_import FROM '/data/gemini_3072_embeddings.csv' WITH (FORMAT csv, HEADER true);
    COPY word_import FROM '/data/word-list.csv' WITH (FORMAT csv, HEADER true);
    COPY hint_import FROM '/data/hints.csv' WITH (FORMAT csv, HEADER true);
    CREATE TABLE words (
      word text PRIMARY KEY,
      embedding vector(3072) NOT NULL,
      is_hint boolean NOT NULL
    );
    INSERT INTO words (word, embedding, is_hint)
    SELECT lower(trim(e.word)), e.embedding_text::vector, h.word IS NOT NULL
    FROM embedding_import e
    JOIN (SELECT DISTINCT lower(trim(word)) word FROM word_import WHERE trim(word) <> '') m
      ON m.word = lower(trim(e.word))
    LEFT JOIN (SELECT DISTINCT lower(trim(word)) word FROM hint_import WHERE trim(word) <> '') h
      ON h.word = m.word;
    ANALYZE words;
    DROP TABLE embedding_import;
    DROP TABLE word_import;
    DROP TABLE hint_import;
  `);
  const result = await client.query<{ count: number }>('SELECT count(*)::int count FROM words');
  if (result.rows[0]?.count !== 64_639) {
    throw new Error(
      `Local pgvector index has ${result.rows[0]?.count ?? 0} words; expected 64,639`
    );
  }
  console.log('Local pgvector index is ready.');
}

async function generate(options: Options): Promise<void> {
  requireFile(EMBEDDINGS_FILE, 'Embeddings CSV');
  requireFile(WORD_LIST_FILE, 'Word list');
  requireFile(HINT_LIST_FILE, 'Hint list');
  requireFile(options.targetsFile, 'Targets CSV');
  options.baselineDir ||= existsSync(join(options.outputDir, '_dictionary.csv.gz'))
    ? options.outputDir
    : LEGACY_BASELINE_DIR;
  requireFile(options.baselineDir, 'Baseline directory');
  if (existsSync(options.outputDir) && !options.force) {
    throw new Error(`Output already exists: ${options.outputDir}. Pass --force to replace it.`);
  }

  const allTargets = loadTargets(options.targetsFile);
  const targets = options.limit ? allTargets.slice(0, options.limit) : allTargets;
  const dictionary = uniqueInOrder(loadOneColumnCsv(WORD_LIST_FILE));
  const hintWords = new Set(loadOneColumnCsv(HINT_LIST_FILE));
  if (dictionary.length !== 64_639) {
    throw new Error(`Dictionary has ${dictionary.length} words; expected 64,639`);
  }
  const wordIds = new Map(dictionary.map((word, id) => [word, id]));
  if (wordIds.size > 65_535) throw new Error('Dictionary no longer fits in uint16 word IDs');

  const staging = `${options.outputDir}.tmp-${process.pid}`;
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  const dictionaryCsv = [
    'id,word,isHint',
    ...dictionary.map((word, id) => `${id},${csvField(word)},${hintWords.has(word)}`),
  ].join('\n');
  writeFileSync(join(staging, '_dictionary.csv.gz'), gzipSync(`${dictionaryCsv}\n`, { level: 9 }));

  const baselines = new Map<string, BaselineRow[]>();
  const goldenRows = ['target,rank,word,similarity'];
  for (const target of targets) {
    const baseline = loadBaseline(options.baselineDir, target, dictionary, hintWords);
    baselines.set(target, baseline);
    for (const row of baseline.slice(0, 25)) {
      goldenRows.push(
        `${csvField(target)},${row.rank},${csvField(row.word)},${row.similarityText}`
      );
    }
  }
  writeFileSync(
    join(staging, '_top25.csv.gz'),
    gzipSync(`${goldenRows.join('\n')}\n`, { level: 9 })
  );

  runDocker(['up', '-d', 'pgvector']);
  await waitForDatabase();
  const port = Number.parseInt(process.env.WORD_DATA_DB_PORT || '55432', 10);
  const bootstrap = new pg.Client({
    host: '127.0.0.1',
    port,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
  });
  await bootstrap.connect();
  try {
    await prepareDatabase(bootstrap, options.rebuildDatabase);
  } finally {
    await bootstrap.end();
  }

  const pool = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    max: options.concurrency,
  });
  const queue = new PQueue({ concurrency: options.concurrency });
  let complete = 0;
  const startedAt = Date.now();
  const tasks = targets.map((target) =>
    queue.add(async () => {
      const result = await pool.query<RankedRow>(
        `SELECT w.word,
                1 - (w.embedding <=> target.embedding) similarity,
                w.is_hint
         FROM words w
         CROSS JOIN (SELECT embedding FROM words WHERE word = $1) target
         WHERE w.word <> $1
         ORDER BY w.embedding <=> target.embedding, w.word`,
        [target]
      );
      const baseline = baselines.get(target)!;
      const encoded = encodeTarget(target, result.rows, baseline, wordIds);
      writeFileSync(join(staging, wordFileName(target)), gzipSync(encoded, { level: 9 }));
      complete++;
      if (complete === targets.length || complete % 25 === 0) {
        const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
        const rate = complete / elapsedSeconds;
        const remainingMinutes = (targets.length - complete) / Math.max(rate, 0.001) / 60;
        console.log(
          `Generated ${complete.toLocaleString()} / ${targets.length.toLocaleString()} targets ` +
            `(${remainingMinutes.toFixed(1)} minutes remaining)`
        );
      }
    })
  );

  try {
    await Promise.all(tasks);
  } finally {
    await pool.end();
    if (!options.keepDatabaseRunning) runDocker(['stop', 'pgvector']);
  }

  if (existsSync(options.outputDir)) {
    rmSync(options.outputDir, { recursive: true, force: true });
  }
  renameSync(staging, options.outputDir);
  console.log(
    `Wrote ${targets.length.toLocaleString()} full-vocabulary files to ${options.outputDir}`
  );
}

const options = parseArgs(process.argv.slice(2));
generate(options).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
