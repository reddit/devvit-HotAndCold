import { Logo, HardcoreMascot } from '../shared/logo';
import { HelpMenu } from '../shared/helpMenu';
import { IconButton } from '../shared/button';
import { InfoIcon } from '../shared/icons';
import { cn } from '../utils/cn';
import { useState } from 'preact/hooks';
import { HowToPlayModal } from './howToPlayModal';
import type { GuessEngine } from '../core/guessEngine';
import {
  loadHintsForChallenge,
  loadPreviousGuessesFromSession,
  selectNextHint,
} from '../core/hints';
// import { context } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { userSettings, toggleLayout, toggleSortType } from './state/userSettings';
import { trpc } from '../trpc';
import { navigate } from './state/navigation';
import { resetGuessCache } from '../core/guess';

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

export function Header({ engine }: { engine?: GuessEngine }) {
  // Local UI state for modals (how-to-play, score breakdown)
  const [isHowToOpen, setHowToOpen] = useState(false);
  // Future: show score breakdown when available
  // const [isScoreOpen, setScoreOpen] = useState(false);

  // Settings via signals
  const layout = userSettings.value.layout;
  const sortType = userSettings.value.sortType;
  const isUserOptedIntoReminders = userSettings.value.isUserOptedIntoReminders;
  const [accessStatus] = useState<'inactive' | 'active'>('inactive');

  const challengeNumber = requireChallengeNumber();

  const isActivelyPlaying = true; // Placeholder; wire real state when available

  async function requestHint() {
    const [hints, previous] = await Promise.all([
      loadHintsForChallenge(challengeNumber),
      Promise.resolve(loadPreviousGuessesFromSession(challengeNumber)),
    ]);
    const next = selectNextHint({ hintWords: hints, previousGuesses: previous });
    if (!next) return;
    // Submit via local engine so UI updates and sync is queued
    try {
      if (engine) {
        await engine.submit(next.word);
      }
    } catch (e) {
      console.error('Failed to submit hint guess', e);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4" data-layout={layout}>
        <div className="flex h-6 flex-1 gap-2 sm:h-10 sm:gap-4">
          {/* Hardcore logo is not migrated; show mascot CTA next to main logo */}
          <Logo />
          <button
            className={cn('flex gap-1', accessStatus === 'inactive' && 'cursor-pointer')}
            onClick={() => {
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

        <div className="flex flex-1 items-center justify-end gap-2">
          <IconButton
            type="button"
            onClick={() => setHowToOpen(true)}
            icon={<InfoIcon />}
            aria-label="How to Play"
          >
            How to Play
          </IconButton>
          <HelpMenu
            items={[
              { name: 'Toggle Size', action: () => toggleLayout() },
              {
                name: isUserOptedIntoReminders ? 'Unsubscribe' : 'Subscribe',
                action: async () => {
                  // TODO: add subscribe endpoint when available
                },
              },
              {
                name: `Sort by ${sortType === 'TIMESTAMP' ? 'Similarity' : 'Time'}`,
                disabled: !isActivelyPlaying,
                action: () => toggleSortType(),
              },
              {
                name: 'Hint',
                disabled: !isActivelyPlaying,
                action: async () => {
                  await requestHint();
                },
              },
              {
                name: 'Give Up',
                disabled: !isActivelyPlaying,
                action: async () => {
                  try {
                    await trpc.guess.giveUp.mutate({ challengeNumber });
                    navigate('win');
                  } catch (e) {
                    console.error('Failed to give up', e);
                  }
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
            ]}
          />
        </div>
      </div>

      <HowToPlayModal isOpen={isHowToOpen} onClose={() => setHowToOpen(false)} />
    </>
  );
}
