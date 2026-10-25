# Experimental moderator settings and player feedback

This preview uses Devvit 0.15.0. Run `npm run dev -- YOUR_TEST_SUBREDDIT`
to target a test installation without changing the shared default. Personal
`*.local.sh` launchers are excluded from Git and source uploads.

The Vite config resolves both PostHog imports in Devvit analytics to its existing
no-external build. This removes a duplicate analytics runtime and reduces the
largest client chunk from about 573 kB to 391 kB without raising the warning limit.

## Moderator tools

- The subreddit menu's **Moderator settings (Experimental)** item creates or
  reopens one reusable launcher post. Its button opens the separate console in
  expanded mode. A moderator-only cog in existing game posts opens the same console.
- The existing menus and developer experiment tools remain available.
- Moderator membership is checked against the current subreddit on every private
  read and action. A Reddit staff/admin flag does not grant moderator access.
  The launcher post itself is not private; its tools and data are access-controlled.
- Queue previews distinguish ready, already used, already queued, repeated, and
  invalid words. Adds revalidate their input. Bulk append/prepend preserves the
  pasted order even within the same millisecond.
- Publishing offers idempotent scheduled-slot recovery and an explicit extra-post
  action. Extra posts default to skipping reminders. Queue clearing requires
  typing CLEAR. Reminder delivery operations remain in their existing menus.

## Player sound and motion

- The speaker starts off in every new webview. Only an explicit sound toggle
  creates audio elements or starts loading audio. Music and effects can be
  controlled independently through **Menu → Sound & effects**.
- Warmer/colder previews do not submit guesses. Real feedback compares a newly
  accepted guess with the preceding guess. Initial history, invalid/duplicate
  submissions, equal ranks, and unranked guesses do not trigger feedback.
- Warm/cold badges are brief and use text as well as color. Motion respects both
  the player's preference and `prefers-reduced-motion`. Hidden/unfocused views
  pause playback; muting immediately stops music and effects.
- Audio is CC0, with no in-game attribution requirement. Sources and conversions
  are recorded in `src/client/public/audio/LICENSE.txt`.

## Redis investigation and fixes

- Full expanded JSON ranking tables are no longer written to installation Redis.
  Ranking requests reuse compressed binary static files and a four-entry memory
  cache. Existing full JSON caches remain a read-only fallback during outages.
- Devvit's cache helper also uses installation Redis. The compact static-file
  cache's freshness TTL is reduced from 30 days to three days (plus the SDK's
  short stale allowance). Existing entries may keep their prior expiration until
  they refresh. This is a reduction in duplicate storage and future retention;
  it does not remove all ranking-related Redis storage.
- Common-words job status writes now include expiration atomically, preventing
  SET from accidentally dropping the TTL. Counts also receive an expiration
  after creation and on cancellation.
- Diagnostics inspect five known puzzles and at most 20 indexed players per
  puzzle. They show stored full-table and compact-cache bytes, shared dictionary
  bytes, index counts, and sampled raw guess payload sizes. The compact-cache
  namespace reader is tied to the pinned SDK's cache implementation.
- These are samples, not a complete installation memory report. Redis overhead,
  unknown legacy cache formats, and old unsolved player keys without surviving
  indexes are not included. Production quota usage still needs measurement before
  attributing its full growth to a particular key family.
- Cleanup previews and deletes only the app's known full JSON ranking cache keys
  for the current data release. It preserves player history, challenge metadata,
  answers, queue contents, compact SDK caches, and leaderboards.

The playtest does not change production installation versions or perform
production data cleanup.
