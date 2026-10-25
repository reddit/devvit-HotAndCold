# Experimental moderator settings and player feedback

This preview uses Devvit 0.15.0. Run `npm run dev -- YOUR_TEST_SUBREDDIT`
to target a test installation without changing the shared default. Personal
`*.local.sh` launchers are excluded from Git and source uploads.

The Vite config resolves both PostHog imports in Devvit analytics to its existing
no-external build. This removes a duplicate analytics runtime and reduces the
largest client chunk from about 573 kB to 391 kB without raising the warning limit.

## Moderator tools

- The expanded console opens on a dashboard with Latest Puzzle, Word Queue,
  Scheduling, Reminders, and Redis cards. Larger actions open dedicated sections
  inside the same single-scroll view. Queue counts are secret words (one per
  puzzle), so days remaining assume one puzzle per day and no extra posts.
- **Notify Low Queue** is an individual moderator opt-in for Reddit DMs, separate
  from player push reminders. An hourly task (minute 35) checks for seven or fewer
  words, then sends one further warning if empty. Refilling above seven words
  rearms alerts, including through legacy queue tools. No answers appear in DMs.
  Opening settings never subscribes anyone or sends a message. Failed deliveries
  can retry next hour; former moderators are removed on checks. Preferences and
  tiny delivery receipts live in `queueAlerts:subscribers`, `queueAlerts:receipts`,
  and `queueAlerts:generation`; the check lease expires after five minutes.
  A new scheduler task requires restarting an existing playtest watcher.

- The subreddit menu's **Moderator Settings (Experimental)** item creates or
  reopens one reusable launcher post. Its button opens the separate console in
  expanded mode. A moderator-only cog in existing game posts opens the same console.
- The existing menus and developer experiment tools remain available.
- Moderator membership is checked against the current subreddit on every private
  read and action. A Reddit staff/admin flag does not grant moderator access.
  The launcher post itself is not private; its tools and data are access-controlled.
- Queue previews distinguish ready, already used, already queued, repeated, and
  invalid words. Adds revalidate their input. Bulk append/prepend preserves the
  pasted order even within the same millisecond.
- Existing answers and queued words are neither displayed nor fetched by default.
  Revealing one answer or one queue page requires a moderation purpose, a written
  reason of at least 20 characters, a no-cheating pledge, and typing REVEAL. The
  server validates this acknowledgement on every reveal request. It is not an
  audit log or a restriction on the existing legacy moderator tools.
- Reveals last up to 60 seconds and clear on tab/page changes, refresh, or leaving
  the view. Pending responses cannot restore words after cancellation. Words typed
  by the moderator for queue validation remain visible as their own input.
- Storage inspection and cleanup use challenge numbers without sending answers to
  the client. Console publishing results and error messages do not expose answers.
  The legacy menu and form flows are unchanged.
- Scheduling offers idempotent scheduled-slot recovery and an explicit extra-post
  action. Extra posts default to skipping reminders. Queue clearing requires
  typing CLEAR. Reminder delivery operations remain in their existing menus.

## Player sound and motion

- The speaker starts off in every new webview. Only an explicit sound toggle
  creates audio elements or starts loading audio. Music and effects can be
  controlled independently through **Menu → Sound & Effects**.
- Warmer/colder previews do not submit guesses. Real feedback compares a newly
  accepted guess with the preceding guess. Initial history, invalid/duplicate
  submissions, equal ranks, and unranked guesses do not trigger feedback.
- Warm/cold badges are brief and use text as well as color. Motion respects both
  the player's preference and `prefers-reduced-motion`. Hidden/unfocused views
  pause playback; muting immediately stops music and effects.
- Audio is CC0, with no in-game attribution requirement. Sources and conversions
  are recorded in `src/client/public/audio/LICENSE.txt`.

## Disposable Test Posts

- In **Scheduling → Playtest Tools**, choose a supported **Test Word** (default:
  apple) and select **Create Test Post**, then **Open Test Post**. Repeating this
  with the same word reuses your most recent test post when it still exists.
- This panel and its APIs require current subreddit moderator membership and a
  Devvit playtest version (the fourth version component described in the Devvit
  docs' `guides/tools/playtest.md`, **Upload your app**). The production community
  is also explicitly excluded. URL parameters or a client-side flag cannot enable
  it in a release build.
- Each moderator has an independent run on the test post. **Reset My Test Run**
  starts empty, including after a win. **Jump to Solved** starts a new run with a
  real winning guess, score, and result screen. Both reload the same test post.
- Every transition allocates a fresh run ID before the game boots. Old requests
  or local caches cannot restore a previous run. Other testers are unaffected.
- Test progress uses `playtest:challenge:*` keys, outside the daily numbering,
  archive, word queue, historical-answer checks, and ordinary leaderboards. Run
  state expires after three days; small post fixtures remain for reuse. Test
  posts send no reminders and do not update the ordinary last-played index.
- The test word is deliberately visible in the test post's title and controls;
  it is never taken from the upcoming daily queue. The regular settings word
  reveal protections and existing moderator flows are unchanged.

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
