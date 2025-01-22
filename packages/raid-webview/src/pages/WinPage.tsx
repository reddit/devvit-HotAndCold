import React from 'react';
import { useGame } from '../hooks/useGame';
import PillSwitch from '@hotandcold/webview-common/components/switcher';

export const WinPage = () => {
  const { challengeInfo, challengeUserInfo } = useGame();
  const [activeIndex, setActiveIndex] = React.useState(0);

  if (!challengeUserInfo || !challengeInfo) return null;

  const word = challengeUserInfo.guesses?.find((x) => x.similarity === 1);

  if (!word) throw new Error('No correct word found?');

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex justify-center">
          <PillSwitch
            activeIndex={activeIndex}
            onChange={setActiveIndex}
            items={[{ name: 'My Stats' }, { name: 'Challenge Stats' }, { name: 'Leaderboard' }]}
          />
        </div>
        {activeIndex === 0 && <p>You win!</p>}
      </div>
    </>
  );
};
