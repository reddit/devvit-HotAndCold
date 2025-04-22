import { Logo } from '@hotandcold/webview-common/components/logo';
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

export const Header = () => {
  const { layout, sortType, isUserOptedIntoReminders } = useUserSettings();
  const setUserSettings = useSetUserSettings();
  const { challengeUserInfo } = useGame();
  const isActivelyPlaying =
    challengeUserInfo?.guesses &&
    challengeUserInfo?.guesses?.length > 0 &&
    !challengeUserInfo?.solvedAtMs &&
    !challengeUserInfo?.gaveUpAtMs;
  const { showConfirmation } = useConfirmation();
  const [howToPlayOpen, setHowToPlayOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <Logo />
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
                name: 'Hint',
                disabled: !isActivelyPlaying,
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
