# Repository guidance

## Project layout

- `src/client` contains the Preact webviews. Use browser-compatible dependencies and prefer Preact signals for shared reactive state.
- `src/server` contains the Devvit serverless backend. Use `fetch` for network calls and `redis` from `@devvit/web/server` for persistence; do not rely on writable local files, sockets, or long-lived in-memory state.
- `src/shared` contains code and types shared by the client and server.
- Keep classic-mode changes under the existing classic paths and horde-mode changes isolated to horde-specific paths.

## Development

- Use TypeScript, named exports, and type aliases where practical.
- Follow the existing formatting and lint rules; avoid unrelated generated word-data changes.
- Use the repository's `devvit-docs` skill for current Devvit API, configuration, and platform questions.

## Checks

- `npm run type-check`
- `npm test` (or `npm test -- <test-file>` for a focused run)
- `npm run lint`
- `npm run build`
