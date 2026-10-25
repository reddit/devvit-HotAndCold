import { Logo } from '../shared/logo';
import { HelpMenu } from '../shared/helpMenu';
import { IconButton } from '../shared/button';
import { useEffect } from 'preact/hooks';
import { openHowToPlay } from './state/howToPlay';
import type { GuessEngine } from '../core/guessEngine';
import {
  loadHintsForChallenge,
  loadPreviousGuessesFromSession,
  selectNextHint,
} from '../core/hints';
import { context, showShareSheet, showToast } from '@devvit/web/client';
import { requireChallengeNumber } from '../requireChallengeNumber';
import { userSettings, setReminderOptIn } from './state/userSettings';
import { trpc } from '../trpc';
import { navigate, page } from './state/navigation';
import { posthog } from '../posthog';
import { openExperiments } from './state/experiments';
import { openArchive } from './state/archive';
import { getBrowserIanaTimeZone } from '../../shared/timezones';
import { isLoggedOut } from '../shared/user';
import { SoundButton } from './feedback/controls';
import { PlayerSettings, settingsOpen } from './settings';
import { HelpIcon, ArchiveIcon, ShareIcon, GearIcon, ActionsIcon } from './icons';

export function Header({
  engine,
  isAdmin,
  isModerator,
}: {
  engine?: GuessEngine;
  isAdmin: boolean;
  isModerator: boolean;
}) {
  const isUserOptedIntoReminders = userSettings.value.isUserOptedIntoReminders;
  const challengeNumber = requireChallengeNumber();
  const isActivelyPlaying =
    page.value === 'play' && !engine?.solvedAtMs.value && !engine?.isSubmitting.value;
  useEffect(() => {
    if (!context.userId) return;
    void trpc.cta.isOptedIntoReminders
      .query()
      .then(setReminderOptIn)
      .catch(() => {});
  }, []);
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
        await engine.submitHint(next.word);
      }
    } catch (e) {
      console.error('Failed to submit hint guess', e);
    }
  }

  async function toggleReminderShared() {
    try {
      if (!context.userId) return isUserOptedIntoReminders;
      const timezone = getBrowserIanaTimeZone();
      const res = await trpc.cta.toggleReminder.mutate({ timezone });
      setReminderOptIn(res.newValue);
      if (res.newValue) {
        posthog.setPersonProperties({ opted_into_reminders: true });
        showToast({ text: 'Subscribed to daily reminders', appearance: 'success' });
      } else {
        posthog.setPersonProperties({ opted_into_reminders: false });
        showToast({ text: 'Unsubscribed from reminders', appearance: 'neutral' });
      }
      return res.newValue;
    } catch (err) {
      console.error('Failed to toggle reminder', err);
      showToast({ text: 'Failed to update reminder settings' });
      return isUserOptedIntoReminders;
    }
  }

  async function shareGame() {
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
  }
  return (
    <>
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="h-6 shrink-0" role="img" aria-label="Hot and Cold">
          <Logo />
        </div>
        <nav
          aria-label="Game Toolbar"
          className="flex w-full items-center justify-between gap-1 min-[420px]:w-auto"
        >
          <IconButton
            iconOnly
            icon={<HelpIcon />}
            aria-label="How to Play"
            onClick={() => {
              posthog.capture('Game Page How to Play Opened');
              openHowToPlay();
            }}
          >
            How to Play
          </IconButton>
          {!isLoggedOut() && (
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
          )}
          <IconButton iconOnly icon={<ShareIcon />} aria-label="Share Game" onClick={shareGame}>
            Share
          </IconButton>
          <div
            className="mx-1 h-5 border-l border-gray-200 dark:border-gray-700"
            aria-hidden="true"
          />
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
          <HelpMenu
            iconOnly
            icon={<ActionsIcon />}
            label="Game Actions"
            items={[
              { name: 'Hint', disabled: !isActivelyPlaying, action: requestHint },
              {
                name: 'Give Up',
                disabled: !isActivelyPlaying,
                action: async () => {
                  try {
                    if (!isLoggedOut()) await trpc.guess.giveUp.mutate({ challengeNumber });
                    navigate('win');
                  } catch {
                    showToast({ text: 'Could not give up right now. Please try again.' });
                  }
                },
              },
              ...(isAdmin
                ? [
                    {
                      name: 'Experiments',
                      section: 'Developer Tools',
                      action: () => {
                        posthog.capture('Game Page Experiments Opened');
                        openExperiments();
                      },
                    },
                    {
                      name: 'Test Push Notification',
                      action: async () => {
                        try {
                          const res = await trpc.notifications.testPush.mutate();
                          showToast({
                            text: res.ok ? 'Notification sent!' : `Failed: ${res.reason}`,
                            appearance: res.ok ? 'success' : 'neutral',
                          });
                        } catch {
                          showToast({ text: 'Failed to send notification', appearance: 'neutral' });
                        }
                      },
                    },
                  ]
                : []),
            ]}
          />
        </nav>
      </header>
      <PlayerSettings isModerator={isModerator} onToggleReminder={toggleReminderShared} />
    </>
  );
}
