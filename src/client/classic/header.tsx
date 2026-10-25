import { Logo, HardcoreMascot } from '../shared/logo';
import { IconButton } from '../shared/button';
import { openHowToPlay } from './state/howToPlay';
import { showShareSheet, showToast } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { posthog } from '../posthog';
import { openArchive } from './state/archive';
import { isLoggedOut } from '../shared/user';
import { SoundButton } from './feedback/controls';
import { PlayerSettings, settingsOpen } from './settings';
import { HelpIcon, ArchiveIcon, ShareIcon, GearIcon, ShieldIcon } from './icons';
import { openModeratorSettings } from './moderator/launch';
import { ReminderButton } from './reminders';
import './toolbar.css';

export function Header({ isModerator }: { isModerator: boolean }) {
  const challengeNumber = requireChallengeNumber();
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
            <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[10px] text-gray-500 italic dark:border-gray-600 dark:text-gray-400">
              Pssst…
            </span>
          </button>
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
            onClick={() => {
              settingsOpen.value = true;
            }}
          >
            Settings
          </IconButton>
          {isModerator && (
            <IconButton
              iconOnly
              icon={<ShieldIcon />}
              aria-label="Moderator Settings (Experimental)"
              onClick={openModeratorSettings}
            >
              Moderator Settings
            </IconButton>
          )}
        </nav>
      </header>
      <PlayerSettings />
    </>
  );
}
