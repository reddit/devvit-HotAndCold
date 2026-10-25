# Experimental moderator settings and player feedback

This preview uses Devvit 0.15.0. Run `npm run dev -- YOUR_TEST_SUBREDDIT`
to target a test installation without changing the shared default. Personal
`*.local.sh` launchers are excluded from Git and source uploads.

The Vite config resolves both PostHog imports in Devvit analytics to its existing
no-external build. This removes a duplicate analytics runtime and reduces the
largest client chunk from about 573 kB to 391 kB without raising the warning limit.

## Moderator tools

- The expanded console replaces tabs and dashboard cards with a navigation list
  in the order **Latest, Schedule, Reminders, Words, Storage**. At wide sizes the
  list sits on the left, with compact summaries and the selected details/actions
  on the right. Narrow sizes show the list first; choosing a section opens its
  details with **Back to Settings**. Both layouts use one main vertical scroller.
  Queue counts are secret words (one per puzzle); days assume one daily puzzle
  and no extra posts. Returning to the list also hides any revealed words.
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
  expanded mode. The moderator shield in the game toolbar opens the same console directly.
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
- Schedule offers idempotent scheduled-slot recovery and an explicit extra-post
  action. Extra posts default to skipping reminders. Queue clearing requires
  typing CLEAR. Reminder delivery operations remain in their existing menus.

## Game Controls and Results

- The larger logo and quiet “Pssst” mascot remain in the header; the mascot opens
  How to Play. The toolbar has Help, Daily Reminders, Archive, Share, Sound,
  Settings, and a moderator-only shield. There is no overflow menu or Moderation
  tab in player settings.
- Toolbar buttons have transparent backgrounds. Hover, keyboard focus, and touch
  presses show the same animated cold-to-hot border as Guess. Reduced motion
  keeps the border still; disabled controls do not animate.
- **Hint** and **Give Up** sit between the input and guess history. Hint unlocks
  after five guesses; Give Up after ten. Give Up requires confirmation and keeps
  existing guesses. These are UI availability thresholds, not API restrictions.
- Hints use actual global ranks instead of treating sparse CSV positions as
  ranks. They choose an unused, closer word near half the best rank, excluding
  the answer. No closer hint means no new guess. Each hint keeps the existing
  0.7 score multiplier (30% reduction per hint).
- The solved screen always offers Share Results with an icon, independently of
  other calls to action. A larger Daily Reminders button appears only after the
  current opt-in is checked and the user is not subscribed. Enabling it hides
  the button and updates the toolbar bell.
- Settings, Give Up confirmation, score details, the comment composer, Playtest
  Controls, Archive, and Moderator Settings open in Reddit's expanded mode. Each
  uses normal scrolling with a close button. How to Play stays a compact inline
  pop-up with the logo, examples, temperature indicators, and help thresholds;
  its content fits without scrolling down to 320 × 440.
- Guess Spacing and Guess Order are explicit two-choice toggles with small sample
  lists inside each option. The Gameplay choices fit without scrolling down to
  320 × 440; opening Troubleshooting can use the expanded view's scroll surface.
  The previews use sample words and do not submit guesses.
- **Clear Word Cache** requires confirmation, clears only downloadable ranking and lemma
  stores, and keeps all local/session history, results, and preferences. It does
  not reload the settings view. Data rebuilds on demand. The
  older “Reset Cache and Reload” flow cleared both browser storage areas and
  could lose unsynced history.
- Results tabs and **Expand Results** open the selected results view in expanded
  mode. Long lists use normal scrolling there; inline results do not capture
  page scrolling. The custom Scroll Up / Scroll Down buttons are removed.
- Expanded mode can replace the game iframe. Unacknowledged guesses are saved
  locally and retried when the game returns, preserving hint flags. Recovery
  first checks server history to avoid resubmitting a word already accepted.
- Developer Tools appear separately below the five moderator navigation items,
  preserving the existing Reddit-admin restriction as well as moderator access.
  Local experiment overrides persist for the current account/browser/app version
  and sync between views. Reopen older playtest views after an update. Test Push
  sends a real notification only when explicitly clicked and requires opt-in.

## Player sound and motion

- Sound defaults to muted. The speaker remembers the current Reddit account's
  choice across posts and app updates, using the `audio:enabled` Redis hash
  (user ID → `1`; muting removes that field). No default or per-post records are
  written. Guests keep their choice locally for this browser/app version.
- Remembered opt-ins wait for a tap or keypress in each new webview before
  loading/playing audio, as required by Reddit's safe-use-of-sound guidelines.
  Music and effects can be controlled independently through
  **Settings → Sound & Effects**.
- Warmer/colder previews do not submit guesses. Real feedback compares a newly
  accepted guess with the preceding guess. Initial history, invalid/duplicate
  submissions, equal ranks, and unranked guesses do not trigger feedback.
- Warm/cold badges are brief and use text as well as color. Motion respects both
  the player's preference and `prefers-reduced-motion`. Hidden/unfocused or
  scrolled-away views pause all playback. An iframe intersection observer and
  document visibility must both allow playback; focusing an off-screen game
  cannot restart it. Returning resumes music, but never replays an old effect.
  Muting immediately stops music and effects.
- Audio is CC0, with no in-game attribution requirement. Sources and conversions
  are recorded in `src/client/public/audio/LICENSE.txt`.

## Disposable Test Posts

- In **Schedule → Playtest Tools**, choose a supported **Test Word** (default:
  apple) and select **Create Test Post**, then **Open Test Post**. Repeating this
  with the same word reuses your most recent test post when it still exists.
- This panel and its APIs require current subreddit moderator membership and a
  Devvit playtest version (the fourth version component described in the Devvit
  docs' `guides/tools/playtest.md`, **Upload your app**). The production community
  is also explicitly excluded. URL parameters or a client-side flag cannot enable
  it in a release build.
- Each moderator has an independent run on the test post. **Reset My Test Run**
  starts empty, including after a win. **Jump to Solved** starts a new run with a
  real winning guess, score, and result screen. Return to the game to use the new run.
- Open the **Playtest** chip beside the mascot for the test word and both run
  controls. It replaces the small “Pssst…” bubble in test posts and adds no banner
  or extra header height. Regular posts keep the “Pssst…” bubble.
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
