import { Logo, HardcoreMascot, HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { HelpMenu } from '@hotandcold/webview-common/components/helpMenu';
import { useConfirmation } from '@hotandcold/webview-common/hooks/useConfirmation';
import { sendMessageToDevvit } from '../utils';
import { useUserSettings, useSetUserSettings } from '../hooks/useUserSettings';
import { useGame } from '../hooks/useGame';
import { useState } from 'react';
import type { UserSettings } from '@hotandcold/classic-shared';
import { HowToPlayModal } from './howToPlayModal';
import { IconButton } from '@hotandcold/webview-common/components/button';
import { InfoIcon } from '@hotandcold/webview-common/components/icon';

const SpeechBubbleTail = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    stroke-linecap="round"
    viewBox="0 0 6 6"
    className={className}
  >
    <path d="M5 1a4 4 0 0 1-4 4" />
  </svg>
);

export const Header = () => {
  const { layout, sortType, isUserOptedIntoReminders } = useUserSettings();
  const setUserSettings = useSetUserSettings();
  const { challengeUserInfo, mode } = useGame();
  const isActivelyPlaying =
    challengeUserInfo?.guesses &&
    challengeUserInfo?.guesses?.length > 0 &&
    !challengeUserInfo?.solvedAtMs &&
    !challengeUserInfo?.gaveUpAtMs;
  const { showConfirmation } = useConfirmation();
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  const isHardcore = mode === 'hardcore';

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex h-6 gap-2 sm:h-10 sm:gap-4">
          {isHardcore ? (
            <HardcoreLogo />
          ) : (
            <>
              <Logo />
              <div className="flex gap-1">
                <HardcoreMascot />
                <span className="relative -translate-y-1/2 self-center rounded-full border border-gray-500 px-2 text-[10px] italic text-gray-400">
                  Pssst...
                  <SpeechBubbleTail className="absolute left-2 top-full h-2 w-2 stroke-gray-500 stroke-1" />
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-1 items-center justify-end gap-2">
          <IconButton
            type="button"
            onClick={() => setHowToPlayOpen(true)}
            icon={<InfoIcon />}
            aria-label="How to Play"
          >
            How to Play
          </IconButton>
          <HelpMenu
            items={[
              {
                name: 'Toggle Size',
                action: () =>
                  setUserSettings((x: UserSettings) => ({
                    ...x,
                    layout: layout === 'CONDENSED' ? 'EXPANDED' : 'CONDENSED',
                  })),
              },
              {
                name: isUserOptedIntoReminders ? 'Unsubscribe' : 'Subscribe',
                action: () => {
                  sendMessageToDevvit({
                    type: 'TOGGLE_USER_REMINDER',
                  });
                },
              },
              {
                name: `Sort by ${sortType === 'TIMESTAMP' ? 'Similarity' : 'Time'}`,
                disabled: !isActivelyPlaying,
                action: () => {
                  setUserSettings((x: UserSettings) => ({
                    ...x,
                    sortType: x.sortType === 'SIMILARITY' ? 'TIMESTAMP' : 'SIMILARITY',
                  }));
                },
              },
              {
                name: isHardcore ? 'No hints in HARDCORE!' : 'Hint',
                disabled: !isActivelyPlaying || isHardcore,
                action: async () => {
                  const response = await showConfirmation({
                    title: 'Are you sure?',
                    description: `Receiving a hint will reduce your final score. Please use them sparingly to stay competitive on the leaderboard.`,
                    confirmText: 'Request Hint',
                    cancelText: 'Cancel',
                  });

                  if (!response.confirmed) return;

                  sendMessageToDevvit({
                    type: 'HINT_REQUEST',
                  });
                },
              },
              {
                name: 'Give Up',
                disabled: !isActivelyPlaying,
                action: async () => {
                  const response = await showConfirmation({
                    title: 'Are you sure?',
                    description: `This will end the game and reveal the word. You won't receive a score for this game.`,
                    confirmText: 'Give Up',
                    cancelText: 'Cancel',
                  });

                  if (!response.confirmed) return;

                  sendMessageToDevvit({
                    type: 'GIVE_UP_REQUEST',
                  });
                },
              },
            ]}
          />
        </div>
      </div>
      <HowToPlayModal isOpen={howToPlayOpen} onClose={() => setHowToPlayOpen(false)} />
    </>
  );
};
