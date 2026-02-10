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

1. Run the `ensure-docs.js` script to clone or refresh the local docs cache.
2. Read the JSON output to get the docs directory path.
3. Search that directory to answer the user's question.
4. Cite specific files/sections in your answer.

## Usage

```bash
node ./scripts/ensure-docs.cjs [--force] [--ttl <hours>] [--project-dir <path>]
```

Script path is relative to this skill's directory.

- `--force` — Pull regardless of cache age
- `--ttl <hours>` — Cache TTL in hours (default: 24)
- `--project-dir <path>` — User's project root for version detection (default: cwd)

**Examples:**

```bash
node ./scripts/ensure-docs.cjs
node ./scripts/ensure-docs.cjs --force
```

## Output

```json
{
  "docsRoot": "node_modules/.cache/devvit-docs/versioned_docs/version-0.11",
  "repoDir": "node_modules/.cache/devvit-docs",
  "appDevvitVersion": "0.11"
}
```

- `docsRoot` — The directory to search. Versioned if a matching version was found, otherwise `docs/`.
- `repoDir` — Root of the cloned repo (use as fallback if versioned docs are incomplete).
- `appDevvitVersion` — Devvit version from the user's `package.json`, or `null`.

## Present Results to User

- Quote the specific doc file and section supporting each claim.
- Provide a minimal code example if the docs include one.
- If the docs don't cover it, say so and suggest the closest material found.

## Troubleshooting

- **`git` not found** — Requires `git` on PATH.
- **Network errors** — Script uses existing cache if pull fails.
- **Stale docs** — Use `--force` to bypass the TTL cache.
