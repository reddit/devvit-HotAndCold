import { Logo, HardcoreMascot } from '../shared/logo';
import { IconButton } from '../shared/button';
import { openHowToPlay } from './state/howToPlay';
import { showShareSheet, showToast } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { posthog } from '../posthog';
import { openArchive } from './state/archive';
import { isLoggedOut } from '../shared/user';
import { SoundButton } from './feedback/controls';
import { openPopup } from './expanded/launch';
import { HelpIcon, ArchiveIcon, ShareIcon, GearIcon } from './icons';
import { ModeratorSettingsButton } from './moderator/button';
import { ReminderButton } from './reminders';
import { TestRunControls } from '../playtest/controls';
import { getActiveTestRun } from '../playtest/run';
import './toolbar.css';

export function Header({
  isModerator,
  isSubmitting = false,
  queueSize,
}: {
  isModerator: boolean;
  isSubmitting?: boolean;
  queueSize?: number | null;
}) {
  const challengeNumber = requireChallengeNumber();
  const isPlaytest = Boolean(getActiveTestRun());
  const howToPlay = () => {
    posthog.capture('Game Page How to Play Opened');
    openHowToPlay();
  };
  const shareGame = async () => {
    posthog.capture('Game Page Share Clicked', { challengeNumber });
    try {
      await showShareSheet({
        title: 'Hot & Cold',
        text: `Play Hot & Cold #${challengeNumber} with me.`,
        data: JSON.stringify({ challengeNumber }),
      });
    } catch {
      showToast({ text: 'Share is unavailable right now' });
    }
  };
  return (
    <>
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-3">
          <div className="h-10 shrink-0" role="img" aria-label="Hot and Cold">
            <Logo />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Pssst… How to Play"
              title="Pssst… Need Help?"
              onClick={howToPlay}
              className="flex items-center gap-1 rounded-lg focus-visible:outline-2 focus-visible:outline-cyan-500"
            >
              <span className="block h-9 w-9 [&>svg]:h-full [&>svg]:w-full" aria-hidden="true">
                <HardcoreMascot />
              </span>
              {!isPlaytest && (
                <span className="w-14 rounded-full border border-gray-300 py-0.5 text-center text-[10px] text-gray-500 italic dark:border-gray-600 dark:text-gray-400">
                  Pssst…
                </span>
              )}
            </button>
            <TestRunControls isSubmitting={isSubmitting} />
          </div>
        </div>
        <nav
          aria-label="Game Toolbar"
          className="game-toolbar flex w-full flex-wrap items-center justify-between min-[560px]:w-auto"
        >
          <IconButton iconOnly icon={<HelpIcon />} aria-label="How to Play" onClick={howToPlay}>
            How to Play
          </IconButton>
          {!isLoggedOut() && (
            <>
              <ReminderButton />
              <IconButton
                iconOnly
                icon={<ArchiveIcon />}
                aria-label="Play the Archive"
                disabled={isSubmitting}
                onClick={(event) => {
                  posthog.capture('Game Page Archive Opened');
                  openArchive(event);
                }}
              >
                Archive
              </IconButton>
            </>
          )}
          <IconButton iconOnly icon={<ShareIcon />} aria-label="Share Game" onClick={shareGame}>
            Share
          </IconButton>
          <SoundButton />
          <IconButton
            iconOnly
            icon={<GearIcon />}
            aria-label="Settings"
            disabled={isSubmitting}
            onClick={(event) => openPopup(event, 'player-settings')}
          >
            Settings
          </IconButton>
          {isModerator && (
            <ModeratorSettingsButton queueSize={queueSize ?? null} disabled={isSubmitting} />
          )}
        </nav>
      </header>
    </>
  );
}
