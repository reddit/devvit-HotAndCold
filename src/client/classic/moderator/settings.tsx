import { useEffect, useState } from 'preact/hooks';
import { context, exitExpandedMode } from '@devvit/web/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server';
import { trpc } from '../../trpc';
import { SettingsIcon, openModeratorSettings } from './launch';

type Outputs = inferRouterOutputs<AppRouter>['moderation'];
type Tab = 'Overview' | 'Word queue' | 'Publishing' | 'Reminders' | 'Redis';
const tabs: Tab[] = ['Overview', 'Word queue', 'Publishing', 'Reminders', 'Redis'];
const button =
  'rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800';
const primary = `${button} !border-cyan-700 !bg-cyan-700 !text-white`;
const panel =
  'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';
const input =
  'w-full rounded-lg border border-gray-300 bg-transparent p-3 text-sm dark:border-gray-700';
const date = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const bytes = (value: number) =>
  value < 1024
    ? `${value} B`
    : value < 1024 * 1024
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1024 / 1024).toFixed(1)} MB`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function ModeratorConsole() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [data, setData] = useState<Outputs['overview'] | null>(null);
  const [queue, setQueue] = useState<Outputs['queue']>([]);
  const [queuePage, setQueuePage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reveal, setReveal] = useState(false);
  const [words, setWords] = useState('');
  const [prepend, setPrepend] = useState(false);
  const [preview, setPreview] = useState<Outputs['previewWords'] | null>(null);
  const [clearConfirm, setClearConfirm] = useState('');
  const [postConfirm, setPostConfirm] = useState(false);
  const [skipNotifications, setSkipNotifications] = useState(true);
  const [sample, setSample] = useState<Outputs['redisSample'] | null>(null);
  const [sampleEnd, setSampleEnd] = useState<number | undefined>(undefined);
  const [cacheConfirm, setCacheConfirm] = useState(false);

  const refresh = async () => {
    const [overview, page] = await Promise.all([
      trpc.moderation.overview.query(),
      trpc.moderation.queue.query({ page: queuePage }),
    ]);
    setData(overview);
    setQueue(page);
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
  }, [queuePage]);

  return (
    <main className="h-[100dvh] overflow-y-auto bg-gray-50 text-gray-950 dark:bg-gray-950 dark:text-gray-100">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-7 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 text-xs font-bold tracking-widest text-cyan-700 uppercase dark:text-cyan-300">
              Hot and Cold · r/{context.subredditName}
            </div>
            <h1 className="text-2xl font-bold">
              Moderator settings{' '}
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [
                  'Latest puzzle',
                  data.challenge ? `#${data.challenge.challengeNumber}` : 'None yet',
                ],
                ['Words queued', `${data.queueSize} ${data.queueSize === 1 ? 'day' : 'days'}`],
                [
                  'Next daily post',
                  new Date(data.nextPostAtMs).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short',
                  }),
                ],
                ['Reminder groups', String(data.notifications.total)],
              ].map(([label, value]) => (
                <div
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
                  key={label}
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
                  <div className="mt-1 text-lg font-bold">{value}</div>
                </div>
              ))}
            </div>
            <nav
              aria-label="Moderator settings sections"
              className="flex flex-wrap gap-1 rounded-xl bg-gray-200/60 p-1 dark:bg-gray-900"
            >
              {tabs.map((name) => (
                <button
                  key={name}
                  className={`grow rounded-lg px-3 py-2 text-sm font-medium ${tab === name ? 'bg-white text-cyan-800 shadow-sm dark:bg-gray-700 dark:text-cyan-200' : 'text-gray-600 dark:text-gray-400'}`}
                  aria-current={tab === name ? 'page' : undefined}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </nav>

            {tab === 'Overview' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <section className={panel}>
                  <h2 className="mb-4 font-bold">Current puzzle</h2>
                  {data.challenge ? (
                    <>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        {[
                          ['Players', data.challenge.totalPlayers ?? 0],
                          ['Solves', data.challenge.totalSolves ?? 0],
                          ['Guesses', data.challenge.totalGuesses ?? 0],
                          ['Hints used', data.challenge.totalHints ?? 0],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
                            <dd className="font-semibold">{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <button
                        className="mt-5 text-sm font-semibold text-cyan-700 underline dark:text-cyan-300"
                        aria-expanded={reveal}
                        onClick={() => setReveal(!reveal)}
                      >
                        {reveal ? 'Hide answer' : 'Reveal answer'}
                      </button>
                      {reveal && (
                        <p className="mt-2 font-mono text-lg">{data.challenge.secretWord}</p>
                      )}
                      {data.challenge.postUrl && (
                        <a
                          className="mt-4 block text-sm underline"
                          href={data.challenge.postUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open game post ↗
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
                  <h2 className="mb-3 font-bold">Daily publishing</h2>
                  <p className="text-sm">
                    Next scheduled post: <strong>{date(data.nextPostAtMs)}</strong>
                  </p>
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                    Daily at 12:00 UTC, with retries at 12:05, 12:15, and 12:30 UTC. Late manual
                    recovery won’t delay the following day.
                  </p>
                  <p className="mt-3 text-xs text-gray-500">
                    This is the configured schedule; it does not confirm a scheduler run has
                    happened.
                  </p>
                </section>
                <section className={`${panel} sm:col-span-2`}>
                  <h2 className="mb-2 font-bold">About this preview</h2>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    The existing moderator menus remain available. “Experiments” in the game menu is
                    a separate developer tool. Sound and motion preferences belong to each player
                    and do not change community settings.
                  </p>
                </section>
              </div>
            )}

            {tab === 'Word queue' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="mb-3 font-bold">Add upcoming words</h2>
                  <label className="mb-2 block text-sm" htmlFor="queue-words">
                    Comma-separated words, or one per line · up to 200
                  </label>
                  <textarea
                    id="queue-words"
                    disabled={busy}
                    rows={4}
                    className={input}
                    value={words}
                    placeholder="ocean, mountain, lantern"
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
                    Place at the front of the queue
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
                      Preview words
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
                      Add ready words
                    </button>
                  </div>
                  {preview && (
                    <div className="mt-4 flex flex-wrap gap-2" aria-label="Word validation preview">
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
                  <h2 className="mb-3 font-bold">Upcoming words · {data.queueSize} total</h2>
                  <ol
                    start={queuePage * 50 + 1}
                    className="list-inside list-decimal columns-2 gap-6 space-y-1 text-sm sm:columns-3"
                  >
                    {queue.map((row) => (
                      <li key={row.word} className="break-inside-avoid">
                        {row.word}
                      </li>
                    ))}
                  </ol>
                  {!queue.length && <p className="text-sm text-gray-500">No words on this page.</p>}
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      className={button}
                      disabled={busy || queuePage === 0}
                      onClick={() => setQueuePage((page) => page - 1)}
                    >
                      Previous
                    </button>
                    <span className="text-sm">Page {queuePage + 1}</span>
                    <button
                      className={button}
                      disabled={busy || (queuePage + 1) * 50 >= data.queueSize}
                      onClick={() => setQueuePage((page) => page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </section>
                <details className={panel}>
                  <summary className="cursor-pointer text-sm font-semibold">
                    Clear the word queue
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
                      Clear queue
                    </button>
                  </div>
                </details>
              </div>
            )}

            {tab === 'Publishing' && (
              <div className="space-y-4">
                <section className={panel}>
                  <h2 className="mb-2 font-bold">Recover today’s scheduled post</h2>
                  <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                    Checks the current daily slot and creates a puzzle only if one is missing. Uses
                    the normal reminder behavior.
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
                    Check and recover
                  </button>
                </section>
                <section className={panel}>
                  <h2 className="mb-2 font-bold">Post the next word now</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Creates an additional puzzle immediately and consumes the next queued word, even
                    if today’s puzzle already exists.
                  </p>
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={skipNotifications}
                      onChange={(event) => setSkipNotifications(event.currentTarget.checked)}
                    />
                    Skip reminder messages
                  </label>
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={postConfirm}
                      onChange={(event) => setPostConfirm(event.currentTarget.checked)}
                    />
                    Create an additional puzzle now
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
                    Post next word
                  </button>
                </section>
              </div>
            )}

            {tab === 'Reminders' && (
              <section className={panel}>
                <h2 className="mb-2 font-bold">Pending reminder groups</h2>
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
                  <h2 className="mb-2 font-bold">Storage investigation</h2>
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
                          setCacheConfirm(false);
                        })
                      }
                    >
                      Inspect latest puzzles
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
                            setCacheConfirm(false);
                          })
                        }
                      >
                        Inspect older puzzles
                      </button>
                    )}
                  </div>
                </section>
                {sample && (
                  <section className={panel}>
                    <h2 className="mb-2 font-bold">Measured sample</h2>
                    <p className="mb-4 text-xs text-gray-500">
                      Shared compact dictionary cache: {bytes(sample.dictionaryBytes)}. Values cover
                      known keys for this data release, excluding Redis overhead.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            {[
                              'Puzzle',
                              'Full JSON cache',
                              'Compact cache',
                              'Solvers indexed',
                              'Progress indexed',
                              'Players sampled',
                              'Guess payloads',
                            ].map((label) => (
                              <th className="p-2 font-semibold" key={label}>
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sample.rows.map((row) => (
                            <tr
                              key={row.challengeNumber}
                              className="border-b border-gray-100 dark:border-gray-800"
                            >
                              <td className="p-2">#{row.challengeNumber}</td>
                              <td className="p-2">{bytes(row.cacheBytes)}</td>
                              <td className="p-2">{bytes(row.compactCacheBytes)}</td>
                              <td className="p-2">{row.players}</td>
                              <td className="p-2">{row.progressPlayers}</td>
                              <td className="p-2">{row.sampledPlayers}</td>
                              <td className="p-2">{bytes(row.sampledGuessBytes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-5 rounded-xl bg-gray-50 p-4 dark:bg-gray-800">
                      <h3 className="text-sm font-semibold">
                        Clear only these full JSON ranking caches
                      </h3>
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-300">
                        {bytes(sample.rows.reduce((sum, row) => sum + row.cacheBytes, 0))} of cached
                        ranking data in this sample. Static files rebuild it on demand. Player
                        history, queued words, answers, and scores are preserved.
                      </p>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={cacheConfirm}
                          onChange={(event) => setCacheConfirm(event.currentTarget.checked)}
                        />
                        Clear the sampled full JSON caches
                      </label>
                      <button
                        className={`${button} mt-3`}
                        disabled={
                          busy || !cacheConfirm || !sample.rows.some((row) => row.cacheBytes > 0)
                        }
                        onClick={() =>
                          void run(async () => {
                            const words = sample.rows.flatMap((row) =>
                              row.word ? [row.word] : []
                            );
                            const result = await trpc.moderation.clearWordCaches.mutate({
                              words,
                              confirm: 'CLEAR_CACHES',
                            });
                            setSample(
                              await trpc.moderation.redisSample.query({ endChallenge: sampleEnd })
                            );
                            setCacheConfirm(false);
                            setNotice(
                              `Cleared ${result.cleared} ranking caches (${bytes(result.bytes)}).`
                            );
                          })
                        }
                      >
                        Clear previewed caches
                      </button>
                    </div>
                  </section>
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
        Moderator settings{' '}
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
            Open moderator settings
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
