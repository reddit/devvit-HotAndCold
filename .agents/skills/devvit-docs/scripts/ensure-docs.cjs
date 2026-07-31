#!/usr/bin/env node

/**
 * Ensures reddit/devvit-docs is cloned locally and reasonably fresh.
 * Cross-platform (Windows, Linux, macOS) — Node.js built-ins + git only.
 *
 * Outputs JSON to stdout: { docsRoot, repoDir, searchRoots, excludeRoots, appDevvitVersion }
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_URL = 'https://github.com/reddit/devvit-docs.git';
const DEFAULT_TTL_HOURS = 24;
const REDDIT_API_PATH = ['docs', 'api', 'redditapi'];
const PUBLIC_API_PATH = ['api', 'public-api'];
const SPARSE_DOC_PATTERNS = [
  '/docs/**/*.md',
  '/docs/**/*.mdx',
  '/versioned_docs/**/*.md',
  '/versioned_docs/**/*.mdx',
  '/versions.json',
];
const DOC_FILE_PATTERN = /\.(?:md|mdx)$/i;

function parseArgs(argv) {
  const args = {
    force: false,
    ttlHours: DEFAULT_TTL_HOURS,
    projectDir: process.cwd(),
    cacheDir: null,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--force') {
      args.force = true;
    } else if (argv[i] === '--ttl') {
      if (!argv[i + 1]) fail('--ttl requires a number of hours.');
      args.ttlHours = Number(argv[++i]);
    } else if (argv[i] === '--project-dir') {
      if (!argv[i + 1]) fail('--project-dir requires a path.');
      args.projectDir = argv[++i];
    } else if (argv[i] === '--cache-dir') {
      if (!argv[i + 1]) fail('--cache-dir requires a path.');
      args.cacheDir = argv[++i];
    } else {
      fail(`Unknown argument: ${argv[i]}`);
    }
  }

  args.projectDir = path.resolve(args.projectDir);
  args.cacheDir = args.cacheDir ? path.resolve(args.cacheDir) : null;
  if (!Number.isFinite(args.ttlHours) || args.ttlHours < 0) {
    fail('--ttl must be a non-negative number of hours.');
  }

  return args;
}

function log(msg) {
  process.stderr.write(`[devvit-docs] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[devvit-docs] Error: ${msg}\n`);
  process.exit(1);
}

function formatError(error) {
  if (error && error.stderr) {
    const stderr = String(error.stderr).trim();
    if (stderr) return stderr;
  }
  if (error && error.message) return error.message;
  return String(error);
}

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function isGitRepo(dir) {
  try {
    const topLevel = git('-C', dir, 'rev-parse', '--show-toplevel');
    const normalize = (value) => {
      let resolved;
      try {
        resolved = fs.realpathSync(value);
      } catch {
        resolved = path.resolve(value);
      }
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    return normalize(topLevel) === normalize(dir);
  } catch {
    return false;
  }
}

function getGitConfig(repoDir, key) {
  try {
    return git('-C', repoDir, 'config', '--get', key);
  } catch {
    return null;
  }
}

function isBloblessPartialClone(repoDir) {
  return (
    getGitConfig(repoDir, 'remote.origin.promisor') === 'true' &&
    getGitConfig(repoDir, 'remote.origin.partialclonefilter') === 'blob:none'
  );
}

function configureSparseDocs(repoDir) {
  git('-C', repoDir, 'sparse-checkout', 'init', '--no-cone');
  git('-C', repoDir, 'sparse-checkout', 'set', '--no-cone', ...SPARSE_DOC_PATTERNS);
}

function cloneRepo(repoDir) {
  git('clone', '--depth', '1', '--filter=blob:none', '--no-checkout', REPO_URL, repoDir);
  configureSparseDocs(repoDir);
  git('-C', repoDir, 'checkout');
}

function replaceWithFreshClone(repoDir, cacheBase) {
  const suffix = `${process.pid}-${Date.now()}`;
  const tempDir = path.join(cacheBase, `devvit-docs.tmp-${suffix}`);
  const backupDir = path.join(cacheBase, `devvit-docs.old-${suffix}`);
  let movedExisting = false;

  try {
    cloneRepo(tempDir);

    if (fs.existsSync(repoDir)) {
      fs.renameSync(repoDir, backupDir);
      movedExisting = true;
    }

    fs.renameSync(tempDir, repoDir);

    if (movedExisting) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (movedExisting && !fs.existsSync(repoDir) && fs.existsSync(backupDir)) {
      try {
        fs.renameSync(backupDir, repoDir);
      } catch {
        // Best effort: leave the backup in place rather than hiding the original error.
      }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

function pullOrRefresh(repoDir, cacheBase) {
  try {
    git('-C', repoDir, 'pull', '--ff-only');
    return true;
  } catch {
    log('Pull failed - trying a fresh clone.');
    try {
      replaceWithFreshClone(repoDir, cacheBase);
      return true;
    } catch {
      log('Fresh clone failed - using existing cache.');
      return false;
    }
  }
}

// Staleness: marker file stores a timestamp. If younger than TTL, skip network.
function isStale(metaPath, ttlHours) {
  try {
    const ts = parseInt(fs.readFileSync(metaPath, 'utf8').trim(), 10) || 0;
    return Date.now() - ts > ttlHours * 3600000;
  } catch {
    return true;
  }
}

function touchMeta(metaPath) {
  fs.writeFileSync(metaPath, String(Date.now()), 'utf8');
}

function uniqueExistingDirs(dirs) {
  const seen = new Set();
  const existing = [];

  for (const dir of dirs) {
    if (!dir) continue;
    if (!fs.existsSync(dir)) continue;

    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;

    seen.add(resolved);
    existing.push(resolved);
  }

  return existing;
}

function isSameOrWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function getRepoCommit(repoDir) {
  try {
    return git('-C', repoDir, 'rev-parse', 'HEAD');
  } catch {
    return null;
  }
}

function validateDocsCheckout(repoDir) {
  const trackedPaths = git(
    '-C',
    repoDir,
    'ls-tree',
    '-r',
    '--name-only',
    'HEAD',
    '--',
    'docs',
    'versioned_docs'
  )
    .split(/\r?\n/)
    .filter(Boolean);

  const docPaths = trackedPaths.filter((trackedPath) => DOC_FILE_PATTERN.test(trackedPath));
  if (docPaths.length === 0) {
    throw new Error('The docs repository contains no Markdown files.');
  }

  const missingDocs = docPaths.filter(
    (trackedPath) => !fs.existsSync(path.join(repoDir, trackedPath))
  );
  if (missingDocs.length > 0) {
    throw new Error(
      `Sparse checkout is missing ${missingDocs.length} tracked documentation file(s), including ${missingDocs
        .slice(0, 3)
        .join(', ')}.`
    );
  }

  const unexpectedContent = trackedPaths.filter(
    (trackedPath) =>
      !DOC_FILE_PATTERN.test(trackedPath) && !trackedPath.split('/').includes('assets')
  );
  if (unexpectedContent.length > 0) {
    throw new Error(
      `The docs repository contains unsupported non-asset content, including ${unexpectedContent
        .slice(0, 3)
        .join(', ')}. Update the sparse checkout patterns.`
    );
  }

  return docPaths.length;
}

function detectVersion(projectDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    const ver = deps.devvit || deps['@devvit/web'] || deps['@devvit/start'] || '';
    const m = String(ver).match(/(\d+)\.(\d+)/);
    return m ? `${m[1]}.${m[2]}` : null;
  } catch {
    return null;
  }
}

function resolveDocsRoot(repoDir, version) {
  if (version) {
    const versioned = path.join(repoDir, 'versioned_docs', `version-${version}`);
    if (fs.existsSync(versioned)) {
      return {
        docsRoot: versioned,
        docsRootType: 'versioned',
        matchedVersion: true,
      };
    }
  }
  return {
    docsRoot: path.join(repoDir, 'docs'),
    docsRootType: 'latest',
    matchedVersion: false,
  };
}

function getVersionedPublicApiRoots(repoDir) {
  const versionedDocsRoot = path.join(repoDir, 'versioned_docs');
  try {
    return fs
      .readdirSync(versionedDocsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(versionedDocsRoot, entry.name, ...PUBLIC_API_PATH));
  } catch {
    return [];
  }
}

function resolveSearchPaths(repoDir, docsRoot) {
  const redditApiRoot = path.join(repoDir, ...REDDIT_API_PATH);
  const searchRoots = uniqueExistingDirs([
    docsRoot,
    isSameOrWithin(redditApiRoot, docsRoot) ? null : redditApiRoot,
  ]);

  const excludeRoots = uniqueExistingDirs([
    path.join(repoDir, 'docs', ...PUBLIC_API_PATH),
    path.join(docsRoot, ...PUBLIC_API_PATH),
    ...getVersionedPublicApiRoots(repoDir),
  ]);

  return { searchRoots, excludeRoots };
}

function main() {
  const args = parseArgs(process.argv);
  const cacheBase =
    args.cacheDir || path.join(args.projectDir, 'node_modules', '.cache', 'devvit-skills');
  const repoDir = path.join(cacheBase, 'devvit-docs');
  const metaPath = path.join(cacheBase, '.devvit-docs-fetched');

  fs.mkdirSync(cacheBase, { recursive: true });

  let refreshed = false;
  if (!fs.existsSync(repoDir) || !isGitRepo(repoDir)) {
    log(
      fs.existsSync(repoDir)
        ? 'Cache invalid - cloning docs (sparse partial)...'
        : 'Cloning docs (sparse partial)...'
    );
    replaceWithFreshClone(repoDir, cacheBase);
    touchMeta(metaPath);
    refreshed = true;
  } else if (!isBloblessPartialClone(repoDir)) {
    log('Legacy full cache detected - migrating to a sparse partial clone...');
    try {
      replaceWithFreshClone(repoDir, cacheBase);
      touchMeta(metaPath);
      refreshed = true;
    } catch (error) {
      log(`Sparse migration failed - using existing cache: ${formatError(error)}`);
    }
  } else {
    // Reapply the canonical patterns so older sparse caches pick up any additions.
    configureSparseDocs(repoDir);
  }

  if (!refreshed && (args.force || isStale(metaPath, args.ttlHours))) {
    log(args.force ? 'Force-pulling docs...' : 'Cache stale — pulling docs...');
    if (pullOrRefresh(repoDir, cacheBase)) {
      touchMeta(metaPath);
    }
  } else if (!refreshed) {
    log('Cache fresh — skipping fetch.');
  }

  const docsFileCount = validateDocsCheckout(repoDir);
  const version = detectVersion(args.projectDir);
  const docsRoot = resolveDocsRoot(repoDir, version);
  const searchPaths = resolveSearchPaths(repoDir, docsRoot.docsRoot);

  process.stdout.write(
    JSON.stringify(
      {
        cacheDir: cacheBase,
        docsRoot: docsRoot.docsRoot,
        repoDir,
        searchRoots: searchPaths.searchRoots,
        excludeRoots: searchPaths.excludeRoots,
        docsRootType: docsRoot.docsRootType,
        matchedVersion: docsRoot.matchedVersion,
        appDevvitVersion: version || null,
        docsRepoCommit: getRepoCommit(repoDir),
        cloneMode: isBloblessPartialClone(repoDir) ? 'sparse-partial' : 'legacy-full',
        docsFileCount,
      },
      null,
      2
    ) + '\n'
  );
}

try {
  main();
} catch (error) {
  fail(formatError(error));
}
