#!/usr/bin/env node

/**
 * Ensures reddit/devvit-docs is cloned locally and reasonably fresh.
 * Cross-platform (Windows, Linux, macOS) — Node.js built-ins + git only.
 *
 * Outputs JSON to stdout: { docsRoot, repoDir, version }
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_URL = "https://github.com/reddit/devvit-docs.git";
const DEFAULT_TTL_HOURS = 24;

function parseArgs(argv) {
  const args = {
    force: false,
    ttlHours: DEFAULT_TTL_HOURS,
    projectDir: process.cwd(),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--force") args.force = true;
    else if (argv[i] === "--ttl" && argv[i + 1])
      args.ttlHours = parseFloat(argv[++i]);
    else if (argv[i] === "--project-dir" && argv[i + 1])
      args.projectDir = argv[++i];
  }
  return args;
}

function log(msg) {
  process.stderr.write(`[devvit-docs] ${msg}\n`);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function isGitRepo(dir) {
  try {
    git("-C", dir, "rev-parse", "--is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
}

function cloneRepo(repoDir) {
  if (fs.existsSync(repoDir)) {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
  git("clone", "--depth", "1", REPO_URL, repoDir);
}

function pullOrReclone(repoDir) {
  try {
    git("-C", repoDir, "pull", "--ff-only");
  } catch {
    log("Pull failed — re-cloning.");
    cloneRepo(repoDir);
  }
}

// Staleness: marker file stores a timestamp. If younger than TTL, skip network.
function isStale(metaPath, ttlHours) {
  try {
    const ts = parseInt(fs.readFileSync(metaPath, "utf8").trim(), 10) || 0;
    return Date.now() - ts > ttlHours * 3600000;
  } catch {
    return true;
  }
}

function touchMeta(metaPath) {
  fs.writeFileSync(metaPath, String(Date.now()), "utf8");
}

function detectVersion(projectDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf8"),
    );
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    const ver =
      deps.devvit || deps["@devvit/web"] || deps["@devvit/start"] || "";
    const m = String(ver).match(/(\d+)\.(\d+)/);
    return m ? `${m[1]}.${m[2]}` : null;
  } catch {
    return null;
  }
}

function resolveDocsRoot(repoDir, version) {
  if (version) {
    const versioned = path.join(
      repoDir,
      "versioned_docs",
      `version-${version}`,
    );
    if (fs.existsSync(versioned)) return versioned;
  }
  return path.join(repoDir, "docs");
}

function main() {
  const args = parseArgs(process.argv);
  const cacheBase = path.join(args.projectDir, "node_modules", ".cache");
  const repoDir = path.join(cacheBase, "devvit-docs");
  const metaPath = path.join(cacheBase, ".devvit-docs-fetched");

  fs.mkdirSync(cacheBase, { recursive: true });

  if (!fs.existsSync(repoDir) || !isGitRepo(repoDir)) {
    log("Cloning docs (shallow)...");
    cloneRepo(repoDir);
    touchMeta(metaPath);
  } else if (args.force || isStale(metaPath, args.ttlHours)) {
    log(args.force ? "Force-pulling docs..." : "Cache stale — pulling docs...");
    pullOrReclone(repoDir);
    touchMeta(metaPath);
  } else {
    log("Cache fresh — skipping fetch.");
  }

  const version = detectVersion(args.projectDir);

  process.stdout.write(
    JSON.stringify(
      {
        docsRoot: resolveDocsRoot(repoDir, version),
        repoDir,
        appDevvitVersion: version || null,
      },
      null,
      2,
    ) + "\n",
  );
}

main();
