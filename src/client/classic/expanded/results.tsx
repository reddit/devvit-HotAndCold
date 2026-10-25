import { useMemo } from 'preact/hooks';
import { WinPage } from '../WinPage';
import { WinPageLoggedOut } from '../WinPageLoggedOut';
import { createGuessEngine } from '../../core/guessEngine';
import { requireChallengeNumber } from '../../requireChallengeNumber';
import { isLoggedOut } from '../../shared/user';

export function ExpandedResults() {
  const engine = useMemo(
    () => (isLoggedOut() ? createGuessEngine({ challengeNumber: requireChallengeNumber() }) : null),
    []
  );
  return engine ? <WinPageLoggedOut engine={engine} expanded /> : <WinPage expanded />;
}
