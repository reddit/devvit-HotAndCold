import { Modal } from '../shared/modal';

type ScoreBreakdown = {
  version: string;
  finalScore: number;
  breakdown: {
    solvingBonus: number;
    timeBonus: { points: number; timeInSeconds: number; isOptimal: boolean };
    guessBonus: { points: number; numberOfGuesses: number; isOptimal: boolean };
    hintPenalty: { numberOfHints: number; penaltyMultiplier: number };
  };
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  score?: ScoreBreakdown | null;
};

const formatTime = (seconds: number): string => seconds.toFixed(3);

export function ScoreBreakdownModal({ isOpen, onClose, score }: Props) {
  if (!score) return null;
  const { finalScore, breakdown } = score;
  const subtotal =
    breakdown.solvingBonus + breakdown.timeBonus.points + breakdown.guessBonus.points;
  const hintPenalty = subtotal * (1 - breakdown.hintPenalty.penaltyMultiplier);

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="w-[min(90vw,28rem)] rounded-xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-6 flex items-baseline justify-between">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Score Breakdown</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">Max possible: 100</span>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-gray-900 dark:text-white">Solving Bonus</span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Base points for solving
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-900 dark:text-white">+{breakdown.solvingBonus}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">max 10</span>
            </div>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-gray-900 dark:text-white">Time Bonus</span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Solved in {formatTime(breakdown.timeBonus.timeInSeconds)}s
                {breakdown.timeBonus.isOptimal && ' (Max bonus achieved!)'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-900 dark:text-white">+{breakdown.timeBonus.points}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">max 40</span>
            </div>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-gray-900 dark:text-white">Guess Bonus</span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {breakdown.guessBonus.numberOfGuesses} guesses
                {breakdown.guessBonus.isOptimal && ' (Max bonus achieved!)'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-gray-900 dark:text-white">+{breakdown.guessBonus.points}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">max 50</span>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-gray-900 dark:text-white">Subtotal</span>
              <span className="text-gray-900 dark:text-white">{subtotal}</span>
            </div>
          </div>

          {breakdown.hintPenalty.numberOfHints > 0 && (
            <div className="flex items-start justify-between text-[#FE5555] dark:text-[#FE5555]">
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

          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <div className="flex items-center justify-between text-lg font-bold">
              <span className="text-gray-900 dark:text-white">Final Score</span>
              <span className="text-gray-900 dark:text-white">{finalScore}</span>
            </div>
          </div>
        </div>

        <p className="mt-6 text-sm italic text-gray-600 dark:text-gray-400">
          Maximize your score by solving quickly, using fewer guesses, and avoiding hints!
        </p>
      </div>
    </Modal>
  );
}
