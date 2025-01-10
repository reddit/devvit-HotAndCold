import { ComponentProps } from 'react';
import { Modal } from '@hotandcold/webview-common/components/modal';
import { useGame } from '../hooks/useGame';

interface ScoreBreakdownModalProps extends Omit<ComponentProps<typeof Modal>, 'children'> {}

const formatTime = (seconds: number): string => {
  return seconds.toFixed(3);
};

export const ScoreBreakdownModal = ({ ...props }: ScoreBreakdownModalProps) => {
  const { challengeUserInfo } = useGame();

  if (!challengeUserInfo?.score) return null;

  const { finalScore, breakdown } = challengeUserInfo.score;
  const subtotal =
    breakdown.solvingBonus + breakdown.timeBonus.points + breakdown.guessBonus.points;
  const hintPenalty = subtotal * (1 - breakdown.hintPenalty.penaltyMultiplier);

  return (
    <Modal {...props}>
      <div className="p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h3 className="text-xl font-bold text-white">Score Breakdown</h3>
          <span className="text-sm text-gray-400">Max possible: 100</span>
        </div>

        <div className="space-y-3">
          {/* Solving Bonus */}
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-white">Solving Bonus</span>
              <span className="text-sm text-gray-400">Base points for solving</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-white">+{breakdown.solvingBonus}</span>
              <span className="text-xs text-gray-400">max 10</span>
            </div>
          </div>

          {/* Time Bonus */}
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-white">Time Bonus</span>
              <span className="text-sm text-gray-400">
                Solved in {formatTime(breakdown.timeBonus.timeInSeconds)}s
                {breakdown.timeBonus.isOptimal && ' (Max bonus achieved!)'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-white">+{breakdown.timeBonus.points}</span>
              <span className="text-xs text-gray-400">max 40</span>
            </div>
          </div>

          {/* Guess Bonus */}
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-white">Guess Bonus</span>
              <span className="text-sm text-gray-400">
                {breakdown.guessBonus.numberOfGuesses} guesses
                {breakdown.guessBonus.isOptimal && ' (Max bonus achieved!)'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-white">+{breakdown.guessBonus.points}</span>
              <span className="text-xs text-gray-400">max 50</span>
            </div>
          </div>

          {/* Subtotal */}
          <div className="border-t border-gray-700 pt-3">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-white">Subtotal</span>
              <span className="text-white">{subtotal}</span>
            </div>
          </div>

          {/* Hint Penalty */}
          {breakdown.hintPenalty.numberOfHints > 0 && (
            <div className="flex items-start justify-between text-[#FE5555]">
              <div className="flex flex-col">
                <span>Hint Penalty</span>
                <span className="text-sm">
                  Used {breakdown.hintPenalty.numberOfHints} hint
                  {breakdown.hintPenalty.numberOfHints > 1 ? 's' : ''}
                </span>
              </div>
              <span>-{Math.round(hintPenalty)}</span>
            </div>
          )}

          {/* Final Score */}
          <div className="border-t border-gray-700 pt-3">
            <div className="flex items-center justify-between text-lg font-bold">
              <span className="text-white">Final Score</span>
              <span className="text-white">{finalScore}</span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-sm italic text-gray-400">
          Maximize your score by solving quickly, using fewer guesses, and avoiding hints!
        </p>
      </div>
    </Modal>
  );
};
