import { Logo, HardcoreMascot } from '../shared/logo';
import { HelpMenu } from '../shared/helpMenu';
import { cn } from '../utils/cn';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { hordeConnectionStatus, hordeGameUpdate } from './state/realtime';
import type { GuessEngine } from '../core/guessEngine';
import { userSettings, toggleLayout } from './state/userSettings';
import { resetGuessCache } from '../core/guess';
import posthog from 'posthog-js';
import { openExperiments } from './state/experiments';

const SpeechBubbleTail = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    strokeLinecap="round"
    viewBox="0 0 6 6"
    className={className}
  >
    <path d="M5 1a4 4 0 0 1-4 4" />
  </svg>
);

export function Header({ engine, isAdmin }: { engine?: GuessEngine; isAdmin: boolean }) {
  // Local UI state for modals (score breakdown placeholder)
  // Future: show score breakdown when available
  // const [isScoreOpen, setScoreOpen] = useState(false);

  // Settings via signals
  const layout = userSettings.value.layout;
  const isUserOptedIntoReminders = userSettings.value.isUserOptedIntoReminders;
  const [accessStatus] = useState<'inactive' | 'active'>('inactive');

  // ---------------------- Horde center status ----------------------
  const status = hordeGameUpdate.value?.hordeStatus ?? 'running';
  const wave = hordeGameUpdate.value?.currentHordeWave ?? 1;
  const timeRemainingMs = hordeGameUpdate.value?.timeRemainingMs ?? null;

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [snapshotMs, setSnapshotMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  useEffect(() => {
    if (Number.isFinite(timeRemainingMs as any)) setSnapshotMs(Date.now());
  }, [timeRemainingMs]);
  const remainingMs = useMemo(() => {
    if (!Number.isFinite(timeRemainingMs as any) || timeRemainingMs == null) return 0;
    const elapsed = Math.max(0, nowMs - snapshotMs);
    return Math.max(0, timeRemainingMs - elapsed);
  }, [timeRemainingMs, nowMs, snapshotMs]);
  const formatRemaining = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `${m}:${pad(s)}`;
  };

  const ConnectionDot = () => {
    const s = hordeConnectionStatus.value;
    const color =
      s === 'connected' ? 'bg-green-500' : s === 'connecting' ? 'bg-yellow-500' : 'bg-red-500';
    const title = `Realtime: ${s}`;
    return <span title={title} className={`inline-block h-2 w-2 rounded-full ${color}`} />;
  };


  return (
    <>
      <div className="flex items-center justify-between mb-4" data-layout={layout}>
        <div className="flex h-6 flex-1 gap-2 sm:h-10 sm:gap-4">
          {/* Hardcore logo is not migrated; show mascot CTA next to main logo */}
          <div
            onClick={() => {
              posthog.capture('Game Page Hardcore Logo Clicked');
            }}
          >
            <Logo />
          </div>
          <button
            className={cn('flex gap-1', accessStatus === 'inactive' && 'cursor-pointer')}
            onClick={() => {
              posthog.capture('Game Page Hardcore Psst Clicked');
              // Placeholder for unlock hardcore modal
            }}
            disabled={accessStatus !== 'inactive'}
            type="button"
          >
            <HardcoreMascot />
            <span className="relative -translate-y-1/2 self-center whitespace-nowrap rounded-full border border-gray-500 px-2 text-[10px] italic text-gray-400">
              {accessStatus === 'inactive' ? 'Pssst...' : 'Thanks for your support!'}
              <SpeechBubbleTail className="absolute left-2 top-full h-2 w-2 stroke-gray-500 stroke-1" />
            </span>
          </button>
        </div>
        {/* Center wave/timer */}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-3 rounded-md border border-gray-300 bg-white/60 px-2 py-0.5 text-xs backdrop-blur dark:border-gray-700 dark:bg-gray-800/60">
            <ConnectionDot />
            <span className="font-medium text-gray-900 dark:text-white">Wave {wave}</span>
            <span className="tabular-nums rounded px-1 py-0.5 text-gray-900 dark:text-white bg-gray-200 dark:bg-gray-700">
              {formatRemaining(remainingMs)}
            </span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <HelpMenu
            items={[
              {
                name: isUserOptedIntoReminders ? 'Unsubscribe' : 'Subscribe',
                action: async () => {
                  // TODO: add subscribe endpoint when available
                },
              },
              {
                name: 'Reset Cache',
                action: async () => {
                  try {
                    await resetGuessCache();
                  } catch (_e) {
                    /* noop */
                  }
                  try {
                    // Clear session and local storage entirely for app keys
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.clear();
                      window.localStorage.clear();
                    }
                  } catch (_e) {
                    /* noop */
                  }
                  // Reload to re-init from server and repopulate state
                  if (typeof window !== 'undefined') {
                    window.location.reload();
                  }
                },
              },
              ...(isAdmin
                ? ([
                    {
                      name: 'Experiments',
                      action: async () => {
                        posthog.capture('Game Page Experiments Opened');
                        openExperiments();
                      },
                    },
                  ] as const)
                : ([] as const)),
            ]}
          />
        </div>
      </div>

      {/* HowToPlayModal is rendered at App level */}
    </>
  );
}
