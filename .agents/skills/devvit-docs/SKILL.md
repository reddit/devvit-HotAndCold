---
name: devvit-docs
description: 'Look up Devvit documentation from the reddit/devvit-docs repository. Use when the user asks about Devvit APIs, patterns, configuration, or examples (trigger phrases: "how do I", "devvit docs", "show me the docs", "API reference").'
---

# Devvit Docs

Look up Devvit documentation from `reddit/devvit-docs`.

**Constraints:**

- Use **only** `reddit/devvit-docs` as the source of truth.
- Do not use other repos, forks, blog posts, or web search results.
- If the answer isn't found, say so and cite the closest relevant file.

## How It Works

1. Run the `ensure-docs.cjs` script to clone or refresh the project-local docs cache.
2. Let the script maintain a blobless sparse clone containing every tracked Markdown and MDX file under `docs/` and `versioned_docs/`, plus `versions.json`. The script verifies the checkout against the Git tree on every run and migrates legacy full clones when possible.
3. Read the JSON output to get the docs directory path.
4. Search the Markdown and MDX files in each `searchRoots` directory, in order, using `rg` when available or another recursive text-search tool as a fallback. Search exact API names and relevant keywords, then open the strongest matches and read their surrounding sections.
5. Do not search or cite files under any path in `excludeRoots`.
6. If the configured search roots are incomplete, search `repoDir` as a fallback while still excluding `excludeRoots`.
7. Cite specific files/sections relative to `repoDir`.

## Usage

```bash
node ./scripts/ensure-docs.cjs [--force] [--ttl <hours>] [--project-dir <path>] [--cache-dir <path>]
```

Script path is relative to this skill's directory.

- `--force` — Pull regardless of cache age
- `--ttl <hours>` — Cache TTL in hours (default: 24)
- `--project-dir <path>` — User's project root for version detection (default: cwd)
- `--cache-dir <path>` — Cache base directory. Stores the clone in `<path>/devvit-docs` (default: `<project-dir>/node_modules/.cache/devvit-skills`)

**Examples:**

```bash
node ./scripts/ensure-docs.cjs
node ./scripts/ensure-docs.cjs --force
node ./scripts/ensure-docs.cjs --cache-dir ./tmp/devvit-cache
```

## Output

```json
{
  "cacheDir": "/path/to/project/node_modules/.cache/devvit-skills",
  "docsRoot": "/path/to/project/node_modules/.cache/devvit-skills/devvit-docs/versioned_docs/version-0.11",
  "repoDir": "/path/to/project/node_modules/.cache/devvit-skills/devvit-docs",
  "searchRoots": [
    "/path/to/project/node_modules/.cache/devvit-skills/devvit-docs/versioned_docs/version-0.11",
    "/path/to/project/node_modules/.cache/devvit-skills/devvit-docs/docs/api/redditapi"
  ],
  "excludeRoots": [
    "/path/to/project/node_modules/.cache/devvit-skills/devvit-docs/docs/api/public-api"
  ],
  "docsRootType": "versioned",
  "matchedVersion": true,
  "appDevvitVersion": "0.11",
  "docsRepoCommit": "3f4f2d1c0b0e...",
  "cloneMode": "sparse-partial",
  "docsFileCount": 1905
}
```

- `cacheDir` — Cache base directory containing the `devvit-docs` clone and fetch metadata.
- `docsRoot` — Primary docs directory. Versioned if a matching version was found, otherwise `docs/`.
- `repoDir` — Root of the cloned repo (use as fallback if versioned docs are incomplete).
- `searchRoots` — Directories to search in order. Includes `docsRoot` and the latest `docs/api/redditapi` reference when present.
- `excludeRoots` — Directories to exclude from searches and citations. Includes `docs/api/public-api` when present.
- `docsRootType` — `versioned` when `docsRoot` matches the app version, otherwise `latest`.
- `matchedVersion` — Whether `docsRoot` matched the detected app version.
- `appDevvitVersion` — Devvit version from the user's `package.json`, or `null`.
- `docsRepoCommit` — Commit hash of the docs repo cache, or `null` if unavailable.
- `cloneMode` — `sparse-partial` for the expected text-only clone, or `legacy-full` when migration could not complete and the existing cache was retained.
- `docsFileCount` — Number of tracked Markdown and MDX documentation files verified in the checkout.

## Present Results to User

- Quote the specific doc file and section supporting each claim.
- Provide a minimal code example if the docs include one.
- If the docs don't cover it, say so and suggest the closest material found.

## Troubleshooting

- **`git` not found** — Requires `git` on PATH.
- **Sparse checkout errors** — Requires a recent Git version with `sparse-checkout` and partial clone support.
- **Network errors** — Script uses an existing cache if refresh fails.
- **Stale docs** — Use `--force` to bypass the TTL cache.
