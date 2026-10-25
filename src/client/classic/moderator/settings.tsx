import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { context, exitExpandedMode } from '@devvit/web/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server';
import { trpc } from '../../trpc';
import { SettingsIcon, openModeratorSettings } from './launch';
import { WordRevealGate } from './wordReveal';
import type { WordRevealAcknowledgement } from '../../../shared/moderation';
import { DEFAULT_TEST_WORD } from '../../../shared/playtest';
import { RedisSamplePanel } from './redisSample';
import { formatBytes as bytes } from './format';
import { ModeratorDashboard, QueueAlertToggle, type ModeratorSection } from './dashboard';

type Outputs = inferRouterOutputs<AppRouter>['moderation'];
const tabs: ModeratorSection[] = [
  'Dashboard',
  'Latest Puzzle',
  'Word Queue',
  'Scheduling',
  'Reminders',
  'Redis',
];
const button =
  'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800';
const primary = `${button} !border-cyan-700 !bg-cyan-700 !text-white`;
const panel =
  'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';
const input =
  'w-full rounded-lg border border-gray-300 bg-transparent p-3 text-sm dark:border-gray-700';
const date = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function ModeratorConsole() {
  const [tab, setTab] = useState<ModeratorSection>('Dashboard');
  const mainRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<Outputs['overview'] | null>(null);
  const [queue, setQueue] = useState<Outputs['queue'] | null>(null);
  const [queuePage, setQueuePage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [answer, setAnswer] = useState<Outputs['revealAnswer'] | null>(null);
  const [revealTarget, setRevealTarget] = useState<'answer' | 'queue' | null>(null);
  const revealVersion = useRef(0);
  const [words, setWords] = useState('');
  const [prepend, setPrepend] = useState(false);
  const [preview, setPreview] = useState<Outputs['previewWords'] | null>(null);
  const [clearConfirm, setClearConfirm] = useState('');
  const [postConfirm, setPostConfirm] = useState(false);
  const [skipNotifications, setSkipNotifications] = useState(true);
  const [sample, setSample] = useState<Outputs['redisSample'] | null>(null);
  const [sampleEnd, setSampleEnd] = useState<number | undefined>(undefined);
  const [sampleVersion, setSampleVersion] = useState(0);
  const [testWord, setTestWord] = useState(DEFAULT_TEST_WORD);
  const [testPostUrl, setTestPostUrl] = useState('');

  const hideWords = useCallback(() => {
    // Invalidate pending requests too: a late response must not reveal words
    // after switching tabs, hiding the view, or cancelling a reveal.
    revealVersion.current++;
    setAnswer(null);
    setQueue(null);
    setRevealTarget(null);
  }, []);
  const refresh = async () => {
    hideWords();
    setData(await trpc.moderation.overview.query());
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run(refresh);
  }, []);
  useEffect(() => {
    const hideWhenHidden = () => {
      if (document.visibilityState !== 'visible') hideWords();
    };
    document.addEventListener('visibilitychange', hideWhenHidden);
    window.addEventListener('blur', hideWords);
    return () => {
      document.removeEventListener('visibilitychange', hideWhenHidden);
      window.removeEventListener('blur', hideWords);
      revealVersion.current++;
    };
  }, [hideWords]);
  useEffect(() => {
    const expiresAtMs = answer?.expiresAtMs ?? queue?.expiresAtMs;
    if (!expiresAtMs) return;
    const timer = setTimeout(hideWords, Math.max(0, expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [answer, queue, hideWords]);
  const confirmReveal = async (acknowledgement: WordRevealAcknowledgement) => {
    const target = revealTarget;
    const version = ++revealVersion.current;
    await run(async () => {
      if (target === 'answer' && data?.challenge) {
        const result = await trpc.moderation.revealAnswer.mutate({
          ...acknowledgement,
          challengeNumber: Number(data.challenge.challengeNumber),
        });
        if (version === revealVersion.current && document.visibilityState === 'visible') {
          setAnswer(result);
          setRevealTarget(null);
        }
      } else if (target === 'queue') {
        const result = await trpc.moderation.queue.mutate({
          ...acknowledgement,
          page: queuePage,
        });
        if (version === revealVersion.current && document.visibilityState === 'visible') {
          setQueue(result);
          setRevealTarget(null);
        }
      }
    });
  };
  const navigate = (section: ModeratorSection) => {
    hideWords();
    setTab(section);
    mainRef.current?.scrollTo({ top: 0 });
  };
  const toggleLowQueueAlerts = () =>
    void run(async () => {
      if (!data) return;
      const result = await trpc.moderation.setLowQueueAlerts.mutate({
        enabled: !data.lowQueueAlertsEnabled,
      });
      setData((current) => current && { ...current, lowQueueAlertsEnabled: result.enabled });
      setNotice(
        result.enabled
          ? 'Low-queue alerts enabled for you. Reddit DMs are checked hourly at seven words or fewer, and again if the queue empties.'
          : 'Low-queue alerts turned off for you.'
      );
    });
  const changeQueuePage = (page: number) => {
    hideWords();
    setQueuePage(page);
  };

  return (
    <main
      ref={mainRef}
      className="h-[100dvh] overflow-y-auto bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-gray-100"
    >
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-7 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-bold tracking-widest text-cyan-700 uppercase dark:text-cyan-300">
              Hot and Cold · r/{context.subredditName}
            </div>
            <h1 className="text-2xl font-bold">
              Moderator Settings{' '}
              <span className="ml-1 inline-block rounded-full bg-amber-100 px-2 py-1 align-middle text-[10px] font-semibold text-amber-900">
                Experimental
              </span>
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Queue tomorrow’s puzzles, manage publishing, and inspect storage.
            </p>
          </div>
          <div className="flex gap-2">
            <button className={button} disabled={busy} onClick={() => void run(refresh)}>
              Refresh
            </button>
            <button className={button} onClick={(event) => exitExpandedMode(event)}>
              Close
            </button>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-xl bg-cyan-50 p-4 text-sm text-cyan-900 dark:bg-cyan-950 dark:text-cyan-100"
          >
            {notice}
          </p>
        )}
        {!data ? (
          <p role="status">
            {busy ? 'Loading community data…' : 'Use Refresh to load community data.'}
          </p>
        ) : (
          <>
            <nav
              aria-label="Moderator Settings Sections"
              className="flex flex-wrap gap-1 rounded-xl bg-gray-200/60 p-1 dark:bg-gray-900"
            >
              {tabs.map((name) => (
                <button
                  key={name}
                  className={`grow rounded-lg px-3 py-2 text-sm font-medium ${tab === name ? 'bg-white text-cyan-800 shadow-sm dark:bg-gray-700 dark:text-cyan-200' : 'text-gray-600 dark:text-gray-400'}`}
                  aria-current={tab === name ? 'page' : undefined}
                  onClick={() => navigate(name)}
                >
                  {name}
                </button>
              ))}
            </nav>

            {tab === 'Dashboard' && (
              <ModeratorDashboard
                data={data}
                busy={busy}
                onNavigate={navigate}
                onToggleAlerts={toggleLowQueueAlerts}
                date={date}
              />
            )}

            {tab === 'Latest Puzzle' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="mb-4 font-bold">
                    Latest Puzzle {data.challenge ? `#${data.challenge.challengeNumber}` : ''}
                  </h2>
                  {data.challenge ? (
                    <>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        {[
                          ['Players', data.challenge.totalPlayers ?? 0],
                          ['Solves', data.challenge.totalSolves ?? 0],
                          ['Guesses', data.challenge.totalGuesses ?? 0],
                          ['Hints Used', data.challenge.totalHints ?? 0],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                            <dd className="font-semibold">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      {answer ? (
                        <div className="mt-5 rounded-xl border border-amber-300 p-3 dark:border-amber-800">
                          <p className="text-xs">Visible temporarily for your moderation task.</p>
                          <p className="mt-2 font-mono text-lg">{answer.word}</p>
                          <button
                            className="mt-3 text-sm font-semibold underline"
                            onClick={hideWords}
                          >
                            Hide Answer Now
                          </button>
                        </div>
                      ) : revealTarget === 'answer' ? (
                        <WordRevealGate
                          target="answer"
                          busy={busy}
                          onCancel={hideWords}
                          onConfirm={confirmReveal}
                        />
                      ) : (
                        <div className="mt-5">
                          <p className="text-sm text-gray-500">The answer is hidden.</p>
                          <button
                            className="mt-2 text-sm font-semibold text-cyan-700 underline dark:text-cyan-300"
                            disabled={busy}
                            onClick={() => setRevealTarget('answer')}
                          >
                            Request Answer Reveal
                          </button>
                        </div>
                      )}
                      {data.challenge.postUrl && (
                        <a
                          className="mt-4 block text-sm underline"
                          href={data.challenge.postUrl}
                          title={data.challenge.postUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open Game Post ↗
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">
                      Add words to the queue, then create the first puzzle.
                    </p>
                  )}
                </section>
                <section className={panel}>
                  <h2 className="mb-2 font-bold">About This Preview</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    The existing moderator menus remain available. “Experiments” in the game menu is
                    a separate developer tool. Sound and motion preferences belong to each player
                    and do not change community settings.
                  </p>
                </section>
              </div>
            )}

            {tab === 'Word Queue' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="font-bold">
                    Word Queue · {data.queueSize.toLocaleString()}{' '}
                    {data.queueSize === 1 ? 'Word' : 'Words'}
                  </h2>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    About {data.queueSize.toLocaleString()} {data.queueSize === 1 ? 'day' : 'days'}{' '}
                    at one puzzle per day. Extra posts use words faster. Add words below without
                    revealing the existing queue.
                  </p>
                  <QueueAlertToggle
                    enabled={data.lowQueueAlertsEnabled}
                    busy={busy}
                    onToggle={toggleLowQueueAlerts}
                  />
                </section>
                <section className={panel}>
                  <h2 className="mb-3 font-bold">Add Upcoming Words</h2>
                  <label className="mb-2 block text-sm" htmlFor="queue-words">
                    Words to Add
                  </label>
                  <p className="mb-2 text-xs text-gray-500">
                    Comma-separated or one per line. Up to 200 words.
                  </p>
                  <textarea
                    id="queue-words"
                    disabled={busy}
                    rows={4}
                    className={input}
                    value={words}
                    placeholder="Paste words to validate…"
                    onInput={(event) => {
                      setWords(event.currentTarget.value);
                      setPreview(null);
                    }}
                  />
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={prepend}
                      onChange={(event) => setPrepend(event.currentTarget.checked)}
                    />
                    Place at the Front of the Queue
                  </label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className={button}
                      disabled={busy || !words.trim()}
                      onClick={() =>
                        void run(async () => {
                          setPreview(await trpc.moderation.previewWords.mutate({ words }));
                        })
                      }
                    >
                      Preview Words
                    </button>
                    <button
                      className={primary}
                      disabled={busy || !preview?.some((row) => row.status === 'ready')}
                      onClick={() =>
                        void run(async () => {
                          const result = await trpc.moderation.addWords.mutate({ words, prepend });
                          setWords('');
                          setPreview(null);
                          await refresh();
                          setNotice(
                            `Added ${result.added} words. Skipped ${result.skipped} used, queued, duplicate, or invalid entries.`
                          );
                        })
                      }
                    >
                      Add Ready Words
                    </button>
                  </div>
                  {preview && (
                    <div className="mt-4 flex flex-wrap gap-2" aria-label="Word Validation Preview">
                      {preview.map((row, index) => (
                        <span
                          key={`${row.word}-${index}`}
                          className={`rounded-lg px-2 py-1 text-xs ${row.status === 'ready' ? 'bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}
                        >
                          {row.word} · {row.status}
                        </span>
                      ))}
                    </div>
                  )}
                </section>
                <section className={panel}>
                  <h2 className="mb-3 font-bold">Upcoming Words · {data.queueSize} Total</h2>
                  {queue ? (
                    <>
                      <p className="mb-3 text-xs text-amber-800 dark:text-amber-200">
                        Visible temporarily for your moderation task. Changing pages hides these
                        words and requires a new confirmation.
                      </p>
                      <ol
                        start={queuePage * 50 + 1}
                        className="list-inside list-decimal columns-2 gap-6 space-y-1 text-sm sm:columns-3"
                      >
                        {queue.words.map((row) => (
                          <li key={row.word} className="break-inside-avoid">
                            {row.word}
                          </li>
                        ))}
                      </ol>
                      {!queue.words.length && (
                        <p className="text-sm text-gray-500">No words on this page.</p>
                      )}
                      <button className={`${button} mt-4`} onClick={hideWords}>
                        Hide Words Now
                      </button>
                    </>
                  ) : revealTarget === 'queue' ? (
                    <WordRevealGate
                      target="queue"
                      busy={busy}
                      onCancel={hideWords}
                      onConfirm={confirmReveal}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 p-5 dark:border-gray-700">
                      <p className="text-sm font-semibold">Upcoming words are hidden.</p>
                      <p className="mt-2 text-sm text-gray-500">
                        Manage the queue without seeing answers. Revealing a page requires a
                        moderation reason, a promise not to cheat, and typed confirmation.
                      </p>
                      <button
                        className={`${button} mt-4`}
                        disabled={busy || queuePage * 50 >= data.queueSize}
                        onClick={() => setRevealTarget('queue')}
                      >
                        Request Queue Reveal
                      </button>
                    </div>
                  )}
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      className={button}
                      disabled={busy || queuePage === 0}
                      onClick={() => changeQueuePage(queuePage - 1)}
                    >
                      Previous
                    </button>
                    <span className="text-sm">Page {queuePage + 1}</span>
                    <button
                      className={button}
                      disabled={busy || (queuePage + 1) * 50 >= data.queueSize}
                      onClick={() => changeQueuePage(queuePage + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
                <details className={panel}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Clear the Word Queue
                  </summary>
                  <p className="my-3 text-sm text-gray-500">
                    Removes all upcoming words. Existing puzzles and player history are preserved.
                    Type CLEAR to confirm.
                  </p>
                  <div className="flex gap-2">
                    <input
                      aria-label="Confirm clearing the queue"
                      className={input}
                      value={clearConfirm}
                      onInput={(event) => setClearConfirm(event.currentTarget.value)}
                    />
                    <button
                      className={button}
                      disabled={busy || clearConfirm !== 'CLEAR'}
                      onClick={() =>
                        void run(async () => {
                          await trpc.moderation.clearQueue.mutate({ confirm: 'CLEAR' });
                          setClearConfirm('');
                          setPreview(null);
                          setQueuePage(0);
                          await refresh();
                          setNotice('Queue cleared.');
                        })
                      }
                    >
                      Clear Queue
                    </button>
                  </div>
                </details>
              </div>
            )}

            {tab === 'Scheduling' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="mb-3 font-bold">Next Scheduled Post</h2>
                  <time
                    className="text-xl font-semibold"
                    dateTime={new Date(data.nextPostAtMs).toISOString()}
                  >
                    {date(data.nextPostAtMs)}
                  </time>
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    Daily at 12:00 UTC, with retries at 12:05, 12:15, and 12:30 UTC. Late manual
                    recovery won’t delay the following day. Times above use your local time zone.
                  </p>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    This is the configured schedule; it does not confirm that a scheduler run has
                    happened.
                  </p>
                </section>
                <section className={panel}>
                  <h2 className="mb-2 font-bold">Recover Today’s Scheduled Post</h2>
                  <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                    Use this when automatic posting appears to have stopped. It checks the current
                    daily slot and creates a puzzle only if one is missing, with normal player
                    reminders. It will not create a duplicate for a slot that already has a puzzle.
                  </p>
                  <button
                    className={primary}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await trpc.moderation.recoverPost.mutate();
                        await refresh();
                        setNotice(
                          result.status === 'created'
                            ? `Created puzzle #${result.challengeNumber}.`
                            : result.status === 'exists'
                              ? `Puzzle #${result.challengeNumber} already covers this posting slot.`
                              : `Recovery status: ${result.status}.`
                        );
                      })
                    }
                  >
                    Check and Recover
                  </button>
                </section>
                <details className={panel}>
                  <summary className="cursor-pointer font-bold">Post an Extra Puzzle Now</summary>
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    Creates an additional puzzle immediately and consumes the next queued word, even
                    if today’s puzzle already exists.
                  </p>
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={skipNotifications}
                      onChange={(event) => setSkipNotifications(event.currentTarget.checked)}
                    />
                    Skip Reminder Messages
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={postConfirm}
                      onChange={(event) => setPostConfirm(event.currentTarget.checked)}
                    />
                    Create an Additional Puzzle Now
                  </label>
                  <button
                    className={`${button} mt-4`}
                    disabled={busy || !postConfirm || data.queueSize === 0}
                    onClick={() =>
                      void run(async () => {
                        const result = await trpc.moderation.postNext.mutate({
                          confirm: 'POST',
                          skipNotifications,
                        });
                        setPostConfirm(false);
                        await refresh();
                        setNotice(`Created puzzle #${result.challenge}.`);
                      })
                    }
                  >
                    Post Extra Puzzle Now
                  </button>
                </details>
                {data.playtestAvailable && (
                  <section className={`${panel} !border-amber-300 dark:!border-amber-900`}>
                    <h2 className="mb-2 font-bold">Playtest Tools</h2>
                    <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                      Create a disposable test post with a known word. Each moderator gets their own
                      run, with Reset My Test Run and Jump to Solved controls. This does not consume
                      queued words, advance daily puzzle numbers, or send reminders.
                    </p>
                    <label htmlFor="test-word" className="mb-2 block text-sm font-semibold">
                      Test Word
                    </label>
                    <input
                      id="test-word"
                      className={input}
                      value={testWord}
                      disabled={busy}
                      maxLength={80}
                      onInput={(event) => {
                        setTestWord(event.currentTarget.value);
                        setTestPostUrl('');
                      }}
                    />
                    <button
                      className={`${button} mt-4`}
                      disabled={busy || !testWord.trim()}
                      onClick={() =>
                        void run(async () => {
                          const result = await trpc.moderation.createTestPost.mutate({
                            word: testWord,
                          });
                          setTestPostUrl(result.postUrl);
                          setNotice(
                            'Test post ready. Open it to play or use the test state controls.'
                          );
                        })
                      }
                    >
                      Create Test Post
                    </button>
                    {testPostUrl && (
                      <a
                        className="mt-4 block text-sm font-semibold underline"
                        href={testPostUrl}
                        title={testPostUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Test Post ↗
                      </a>
                    )}
                  </section>
                )}
              </div>
            )}

            {tab === 'Reminders' && (
              <section className={panel}>
                <h2 className="mb-2 font-bold">Pending Reminder Groups</h2>
                <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
                  {data.notifications.total} groups pending. Each group may contain multiple
                  recipients. The existing reminder menus remain available for delivery actions.
                </p>
                <ul className="space-y-3">
                  {data.notifications.next.map((group) => (
                    <li
                      key={group.groupId}
                      className="flex flex-wrap justify-between gap-2 border-b border-gray-100 pb-3 text-sm dark:border-gray-800"
                    >
                      <span className="font-mono text-xs break-all">{group.groupId}</span>
                      <time dateTime={new Date(group.dueAtMs).toISOString()}>
                        {date(group.dueAtMs)}
                      </time>
                    </li>
                  ))}
                </ul>
                {!data.notifications.total && <p className="text-sm">No groups are waiting.</p>}
              </section>
            )}

            {tab === 'Redis' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="mb-2 font-bold">Storage Investigation</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    Inspect five puzzles at a time and up to 20 player records per puzzle. These are
                    stored payload sizes, not total Redis memory or an estimate for the whole
                    installation. Older unsolved players may no longer have a discoverable index.
                  </p>
                  <p className="mt-3 text-sm text-gray-500">
                    Word rankings reuse the compact static-file cache instead of adding duplicate
                    full JSON tables to Redis. New compact caches refresh after three days; existing
                    caches may keep their earlier expiration until refreshed. Old full tables remain
                    an outage fallback and can be cleared below. Saved guesses and leaderboard
                    results keep their current retention.
                  </p>
                  <p className="mt-3 text-sm text-gray-500">
                    Common-words job: {data.job?.status ?? 'idle'}
                    {data.job ? ` · ${data.job.totalProcessed} records processed` : ''}. Job state
                    and temporary counts expire after three days, including cancelled jobs.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      className={primary}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          setSample(await trpc.moderation.redisSample.query({}));
                          setSampleEnd(undefined);
                          setSampleVersion((value) => value + 1);
                        })
                      }
                    >
                      Inspect Latest Puzzles
                    </button>
                    {sample?.nextEnd && (
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const end = sample.nextEnd!;
                            setSample(
                              await trpc.moderation.redisSample.query({ endChallenge: end })
                            );
                            setSampleEnd(end);
                            setSampleVersion((value) => value + 1);
                          })
                        }
                      >
                        Inspect Older Puzzles
                      </button>
                    )}
                  </div>
                </section>
                {sample && (
                  <RedisSamplePanel
                    key={sampleVersion}
                    sample={sample}
                    busy={busy}
                    onClear={async (challengeNumbers) => {
                      await run(async () => {
                        const result = await trpc.moderation.clearWordCaches.mutate({
                          challengeNumbers,
                          confirm: 'CLEAR_CACHES',
                        });
                        setSample(
                          await trpc.moderation.redisSample.query({ endChallenge: sampleEnd })
                        );
                        setSampleVersion((value) => value + 1);
                        setNotice(
                          `Cleared ${result.cleared} full JSON fallback caches (${bytes(result.bytes)}). Game data and compact caches were preserved.`
                        );
                      });
                    }}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export function ModeratorEntry({ launcher = false }: { launcher?: boolean }) {
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  useEffect(() => {
    void trpc.moderation.access
      .query()
      .then((result) => setAccess(result.isModerator ? 'allowed' : 'denied'))
      .catch(() => setAccess('error'));
  }, []);
  if (access === 'allowed' && !launcher) return <ModeratorConsole />;
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center gap-4 bg-gray-50 px-6 text-center text-gray-950 dark:bg-gray-950 dark:text-white">
      <SettingsIcon />
      <h1 className="text-xl font-bold">
        Moderator Settings{' '}
        <span className="block text-xs font-normal text-gray-500">Experimental · Hot and Cold</span>
      </h1>
      {access === 'loading' ? (
        <p role="status">Checking moderator access…</p>
      ) : access === 'allowed' ? (
        <>
          <p className="max-w-sm text-sm text-gray-500">
            Manage the word queue, daily posts, reminders, and Redis diagnostics in r/
            {context.subredditName}.
          </p>
          <button className={primary} onClick={openModeratorSettings}>
            Open Moderator Settings
          </button>
        </>
      ) : (
        <p className="max-w-sm text-sm text-gray-500">
          {access === 'error'
            ? 'Unable to check access. Please refresh and try again.'
            : 'These tools are available to this community’s moderators.'}
        </p>
      )}
    </div>
  );
}
