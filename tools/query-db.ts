#!/usr/bin/env node --experimental-strip-types
/**
 * query-db.ts — Run arbitrary SQL against the existing `vectors.sqlite` database.
 *
 * Examples
 *   node --experimental-strip-types query-db.ts "SELECT word FROM words LIMIT 10;"
 *   node --experimental-strip-types query-db.ts --file my-query.sql
 *   echo "PRAGMA table_info(words);" | node --experimental-strip-types query-db.ts
 *
 * The script prints any resulting rows as tab-separated values.  If the
 * statement does not return rows (e.g. `CREATE`, `INSERT`, `UPDATE`) it is
 * executed and a confirmation message is printed.
 */

import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_DIR = join(TOOLS_DIR, '..', 'words');

const DB_FILE = join(WORDS_DIR, 'vectors.sqlite');

function printRows(rows: any[]) {
  if (rows.length === 0) {
    console.log('(no rows)');
    return;
  }
  const columns = Object.keys(rows[0]);
  console.log(columns.join('\t'));
  for (const row of rows) {
    console.log(columns.map((c) => String(row[c])).join('\t'));
  }
}

async function readStdin(): Promise<string> {
  const decoder = new TextDecoder();
  let sql = '';
  for await (const chunk of process.stdin) {
    sql += decoder.decode(chunk);
  }
  return sql;
}

async function main() {
  const [, , ...args] = process.argv;

  // Support: 1) SQL passed directly, 2) --file <path>, 3) stdin
  let sql: string | undefined;

  const fileIdx = args.indexOf('--file');
  if (fileIdx !== -1) {
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('--file flag provided without a path');
      process.exit(1);
    }
    sql = readFileSync(filePath, 'utf8');
  } else if (args.length > 0) {
    sql = args.join(' ');
  } else if (!process.stdin.isTTY) {
    sql = await readStdin();
  }

  if (!sql || sql.trim() === '') {
    console.error(
      'No SQL provided. Pass the query as an argument, via --file <path>, or through stdin.'
    );
    process.exit(1);
  }

  const db = new Database(DB_FILE);
  // Load the sqlite-vec extension so cosine distance etc. work.
  sqliteVec.load(db);

  try {
    const stmt = db.prepare(sql);

    if (stmt.reader) {
      // Statement returns rows (SELECT, PRAGMA, etc.)
      const rows = stmt.all();
      printRows(rows);
    } else {
      // Non‐reader statements (CREATE, INSERT, UPDATE, etc.)
      stmt.run();
      console.log('Statement executed successfully.');
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
