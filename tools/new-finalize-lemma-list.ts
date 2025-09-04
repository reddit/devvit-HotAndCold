#!/usr/bin/env node --experimental-strip-types

import { promises as fsp } from 'fs';
import { basename, dirname, join } from 'path';
import { BRITISH_TO_AMERICAN_MAP } from './word-utils.ts';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(TOOLS_DIR, '..');
const WORDS_NEW_DIR = join(ROOT_DIR, 'words', 'new');

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

type WordLemmaFilter = {
  name: string;
  fn: (entry: Row) => boolean; // return true if the row should be filtered (removed)
};

// For certain lemmas, remove all rows except a single explicitly allowed word→lemma pair.
// Example: keep only "instructions,instruction" and remove other expansions for the lemma "instruction".
const selectiveLemmaKeep: Record<string, string> = {
  // Add more like:
  // organisation: 'organization',
  instruction: 'instructions',
};

function buildFilters(): WordLemmaFilter[] {
  const invalidLemmas = new Set(['sett', 'hasidic', 'clomiphene']);
  const invalidExpandedWords = new Set(['more', 'most', 's']);

  const filters: WordLemmaFilter[] = [
    {
      name: 'selectiveLemmaKeep',
      fn: ({ word, lemma }) => {
        const keep = selectiveLemmaKeep[lemma];
        if (!keep) return false; // not restricted
        // If the word is not the explicitly allowed one for this lemma, filter it out
        return word !== keep;
      },
    },
    {
      name: 'invalidLemma',
      fn: ({ lemma }) => invalidLemmas.has(lemma),
    },
    {
      name: 'invalidExpandedWord',
      fn: ({ word }) => invalidExpandedWords.has(word),
    },
    {
      name: 'isPossessiveExpandedWord',
      fn: ({ word }) => /'/.test(word),
    },
  ];

  return filters;
}

function applyFilters(rows: Row[], filters: WordLemmaFilter[]): { kept: Row[]; removed: Row[] } {
  const kept: Row[] = [];
  const removed: Row[] = [];
  for (const r of rows) {
    let filtered = false;
    for (const f of filters) {
      if (f.fn(r)) {
        filtered = true;
        break;
      }
    }
    if (filtered) removed.push(r);
    else kept.push(r);
  }
  return { kept, removed };
}

type CanonicalizeResult = {
  rows: Row[];
  changedRows: number;
  droppedDuplicates: number;
};

// Collapse lemmas by following lemma->lemma edges inferred from rows where a lemma appears as a word.
// - Build outgoing edges for each source (word) to its target lemma(s).
// - Compute a canonical representative for every node by following best-scored edges, resolving cycles deterministically.
// - Rewrite each row's lemma to the canonical representative and deduplicate identical pairs.
function canonicalizeLemmas(rows: Row[]): CanonicalizeResult {
  // inCounts: how many times a node is used as a lemma overall (vote for being a canonical head)
  const inCounts = new Map<string, number>();
  // outCounts: for each source node, a map of target->count from rows where word==source and lemma==target
  const outCounts = new Map<string, Map<string, number>>();

  // Count lemma indegrees and build potential lemma->lemma edges.
  for (const { word, lemma } of rows) {
    inCounts.set(lemma, (inCounts.get(lemma) || 0) + 1);
    let targets = outCounts.get(word);
    if (!targets) {
      targets = new Map<string, number>();
      outCounts.set(word, targets);
    }
    targets.set(lemma, (targets.get(lemma) || 0) + 1);
  }

  const hasOutgoing = (node: string): boolean => {
    const m = outCounts.get(node);
    if (!m) return false;
    for (const _ of m) return true;
    return false;
  };

  function pickBestTarget(source: string): string | null {
    const options = outCounts.get(source);
    if (!options || options.size === 0) return null;

    // Score candidates by:
    // 1) Highest edge weight from source (how often source→target occurs in CSV)
    // 2) Highest indegree overall (more words map to it globally)
    // 3) Prefer terminals (those without outgoing edges)
    // 4) Lexicographic tie-breaker for determinism
    let best: string | null = null;
    let bestScore: [number, number, number, string] | null = null;
    for (const [target, edgeCount] of options.entries()) {
      const indeg = inCounts.get(target) || 0;
      const terminalBonus = hasOutgoing(target) ? 0 : 1; // prefer terminals
      const score: [number, number, number, string] = [edgeCount, indeg, terminalBonus, target];
      if (
        !best ||
        score[0] > (bestScore as [number, number, number, string])[0] ||
        (score[0] === (bestScore as [number, number, number, string])[0] &&
          (score[1] > (bestScore as [number, number, number, string])[1] ||
            (score[1] === (bestScore as [number, number, number, string])[1] &&
              (score[2] > (bestScore as [number, number, number, string])[2] ||
                (score[2] === (bestScore as [number, number, number, string])[2] &&
                  score[3] < (bestScore as [number, number, number, string])[3])))))
      ) {
        best = target;
        bestScore = score;
      }
    }
    return best;
  }

  const canonical = new Map<string, string>();
  const visiting = new Set<string>();

  function resolveCanonical(node: string): string {
    if (canonical.has(node)) return canonical.get(node)!;
    if (visiting.has(node)) {
      // Cycle detected. Extract cycle members from current visiting set intersection along a heuristic:
      // For determinism in absence of an explicit stack, choose representative by global criteria
      // among nodes currently in the visiting set.
      const cycleNodes = Array.from(visiting);
      // Pick representative by highest indegree, then lexicographic.
      let rep: string = node;
      if (cycleNodes.length > 0) rep = cycleNodes[0]!;
      let repScore: [number, string] = [inCounts.get(rep) || 0, rep];
      for (const n of cycleNodes) {
        const sc: [number, string] = [inCounts.get(n) || 0, n];
        if (sc[0] > repScore[0] || (sc[0] === repScore[0] && sc[1] < repScore[1])) {
          rep = n;
          repScore = sc;
        }
      }
      for (const n of cycleNodes) canonical.set(n, rep);
      return rep;
    }

    visiting.add(node);
    const next = pickBestTarget(node);
    let rep: string;
    if (!next || next === node) {
      rep = node;
    } else {
      rep = resolveCanonical(next);
    }
    visiting.delete(node);
    canonical.set(node, rep);
    return rep;
  }

  // Rewrite rows with canonical lemmas and dedupe pairs.
  const out: Row[] = [];
  const seen = new Set<string>();
  let changedRows = 0;
  let droppedDuplicates = 0;
  for (const r of rows) {
    const canon = resolveCanonical(r.lemma);
    const key = r.word + '\t' + canon;
    if (seen.has(key)) {
      droppedDuplicates++;
      continue;
    }
    seen.add(key);
    if (canon !== r.lemma) changedRows++;
    out.push({ word: r.word, lemma: canon });
  }

  return { rows: out, changedRows, droppedDuplicates };
}

type RemapResult = {
  rows: Row[];
  changedRows: number;
  droppedDuplicates: number;
};

// Source of truth for British→American spelling map now lives in word-utils.ts

function applyLemmaRemap(rows: Row[], remap: Map<string, string>): RemapResult {
  const out: Row[] = [];
  const seen = new Set<string>();
  let changedRows = 0;
  let droppedDuplicates = 0;

  for (const r of rows) {
    let target = r.lemma;
    // Follow transitive remaps defensively to a stable representative.
    const localSeen = new Set<string>();
    while (remap.has(target) && !localSeen.has(target)) {
      localSeen.add(target);
      target = remap.get(target)!;
    }
    const key = r.word + '\t' + target;
    if (seen.has(key)) {
      droppedDuplicates++;
      continue;
    }
    seen.add(key);
    if (target !== r.lemma) changedRows++;
    out.push({ word: r.word, lemma: target });
  }

  return { rows: out, changedRows, droppedDuplicates };
}

async function ensureDir(path: string): Promise<void> {
  await fsp.mkdir(path, { recursive: true });
}

async function writeCsv(path: string, rows: Row[]): Promise<void> {
  const header = 'word,lemma';
  const out = [header, ...rows.map((r) => `${r.word},${r.lemma}`)].join('\n') + '\n';
  await fsp.writeFile(path, out, 'utf8');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveInputPath(arg: string | undefined): Promise<string> {
  const candidates: string[] = [];
  if (arg && arg !== '-') candidates.push(arg);
  candidates.push(
    join(WORDS_NEW_DIR, 'lemma-map-full.retried.csv'),
    join(WORDS_NEW_DIR, 'lemma-map-full.cleaned.csv'),
    join(WORDS_NEW_DIR, 'lemma-map-full.csv')
  );
  for (const p of candidates) {
    if (await pathExists(p)) return p;
  }
  throw new Error(`Could not find an input CSV. Tried:\n${candidates.join('\n')}`);
}

function buildDefaultOutputPath(inputPath: string): string {
  const nameNoExt = basename(inputPath).replace(/\.csv$/i, '');
  return join(WORDS_NEW_DIR, `${nameNoExt}.final.csv`);
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

async function main() {
  // Usage: new-finalize-lemma-list.ts [inputCsv] [--in-place|-i] [--output <path>]
  const { inPlace, outputPathArg } = parseFlags(process.argv);
  const rawInputArg =
    process.argv[2] && !process.argv[2]!.startsWith('-') ? process.argv[2] : undefined;
  const inputPath = await resolveInputPath(rawInputArg);
  const defaultOutputPath = buildDefaultOutputPath(inputPath);
  const outputPath = inPlace ? inputPath : outputPathArg || defaultOutputPath;

  const csv = await loadCsv(inputPath);
  const rows = parseRows(csv);

  const filters = buildFilters();
  const { kept, removed } = applyFilters(rows, filters);

  // Final merge step: collapse lemmas transitively and deduplicate.
  const { rows: mergedRows, changedRows, droppedDuplicates } = canonicalizeLemmas(kept);

  // Remap lemma spellings to US variants and dedupe.
  const remap = BRITISH_TO_AMERICAN_MAP;
  const {
    rows: remappedRows,
    changedRows: remapChanged,
    droppedDuplicates: remapDropped,
  } = applyLemmaRemap(mergedRows, remap);

  await ensureDir(dirname(outputPath));
  await writeCsv(outputPath, remappedRows);

  console.log(`Input rows: ${rows.length.toLocaleString()}`);
  console.log(`Removed rows: ${removed.length.toLocaleString()}`);
  console.log(`Kept rows (pre-merge): ${kept.length.toLocaleString()}`);
  console.log(`Rows with changed lemma after merge: ${changedRows.toLocaleString()}`);
  console.log(`Dropped duplicate pairs after merge: ${droppedDuplicates.toLocaleString()}`);
  console.log(`Rows with changed lemma after remap: ${remapChanged.toLocaleString()}`);
  console.log(`Dropped duplicate pairs after remap: ${remapDropped.toLocaleString()}`);
  console.log(`Kept rows (post-remap): ${remappedRows.length.toLocaleString()}`);
  console.log(`Wrote: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
