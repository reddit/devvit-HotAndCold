## Hot & Cold — HORDE Mode Rules

### Goal

- Work together in real time to clear a sequence of secret words ("waves").
- Smaller rank = closer. Rank #1 is the secret word.

### Game flow

- The horde starts with a shared countdown clock.
  - Initial time: 10 minutes (600,000 ms).
  - The timer ticks down continuously while the game is running.
- Waves (levels):
  - The challenge contains an ordered list of secret words.
  - The active wave is `currentHordeLevel` (1-based).
  - A wave is cleared when someone guesses the current wave’s target word exactly.
  - On clear:
    - The winner’s username is recorded for that wave.
    - +2 minutes are added to the shared timer.
    - `currentHordeLevel` is incremented (proceed to the next word).
    - A realtime `wave_cleared` event is emitted to all clients.
    - Clients may show a brief (10s) celebratory countdown before continuing; the backend already accepts guesses for the next wave.

### Submitting guesses

- All guesses are submitted to the server (no local-only solves).
- The server validates guesses and updates shared counters:
  - Total players, total guesses.
  - Per-user guess count (used for a "top guessers" list).
  - Global "top guesses" board (best rank per word + authors).

### Ranks and hints

- Each guess returns a similarity and a rank (lower is better).
- Hints may be submitted; they count toward total hints/guesses but do not advance waves unless they exactly match the secret word.

### Realtime updates

- Clients subscribe to channel `horde-challenge-<challengeNumber>`.
- Server emits two types of messages:
  - `guess_batch`: the most recent guesses and authors.
  - `game_update`: authoritative snapshot for syncing late joiners or recovering clients.

### What’s in a game_update

- Always an object of shape:
  - `challengeNumber`
  - `totalPlayers`, `totalGuesses`
  - `currentHordeLevel` (1-based)
  - `timeRemainingMs`
  - `status`: `'running' | 'lost' | 'won'`
  - `winners`: array of usernames, index = wave−1 (i.e., `winners[0]` is winner for wave 1)
  - `topGuesses`: up to the 50 best words by rank, with authors
  - `topGuessers`: up to the 20 users with the most guesses { username, count }

### Heartbeat (server → clients)

- A scheduler runs every 5 seconds and emits a `game_update` snapshot.
- This heartbeat also decrements the shared timer server-side.
- If time reaches 0, the server marks the challenge as `'lost'` and continues emitting that terminal state.
- When `currentHordeLevel` advances beyond the final word, the status becomes `'won'`.

### Joining late

- New players connect to the same channel and immediately receive the latest `game_update` within a few seconds.
- Clients render the current wave, time remaining, winners so far, and top lists.

### Anti-race and consistency notes

- Only the word for the current wave can clear that wave.
- The server records exactly one winner per wave (first accepted guess), increments the wave, and adds time once.
- If multiple users guess simultaneously, only the first is recorded; the rest are normal guesses.

### Channel and permissions

- Realtime channel name: `horde-challenge-<challengeNumber>` (hyphens, no colons).
- Realtime is enabled in the app config; messages are sent from the server and received by clients.

### Admin/scheduler wiring (implementation detail)

- A cron task runs every 5 seconds and posts to `/internal/horde/scheduler/game-update`.
- The handler sends a `game_update` snapshot and ticks the timer down.

### Quick glossary

- `wave` / `currentHordeLevel`: The 1-based index of the active secret word.
- `winners[]`: Username recorded per wave, e.g., `winners[2]` is the wave-3 winner.
- `topGuesses`: Best-so-far words by lowest rank across all guesses this challenge.
- `topGuessers`: Users ranked by number of guesses this challenge.

### Edge cases (expected handling)

- Duplicate wave clears: server dedupes; only first counts.
- Late joins: synced by heartbeat snapshots.
- Client reloads: safe; reconnects to realtime and syncs within seconds.
