import { Modal } from '../shared/modal';
import { howToPlayOpen, closeHowToPlay } from './state/howToPlay';

export function HowToPlayModal() {
  return (
    <Modal isOpen={howToPlayOpen.value} onClose={closeHowToPlay}>
      <div className="p-6">
        <h3 className="mb-4 text-xl font-bold dark:text-white">How to Play</h3>
        <div className="space-y-4">
          <p className="text-sm leading-6 dark:text-gray-300">
            Guess the secret word by typing any word you think is related.
            <span className="font-medium dark:text-white"> Rank (#)</span> shows how close your
            guess is compared to all other words. Lower is better.
          </p>

          <div className="space-y-2">
            <p className="text-sm leading-6 dark:text-gray-300">Examples:</p>
            <ul className="list-inside list-disc space-y-1 text-sm leading-6 dark:text-gray-300">
              <li>
                Secret word: <span className="font-medium">car</span>
              </li>
              <li>
                <span className="font-medium">truck</span> →{' '}
                <span className="font-medium">#12</span> (very close)
              </li>
              <li>
                <span className="font-medium">tire</span> →{' '}
                <span className="font-medium">#344</span> (close-ish)
              </li>
              <li>
                <span className="font-medium">banana</span> →{' '}
                <span className="font-medium">#45,333</span> (far)
              </li>
            </ul>
          </div>
        </div>
      </div>
    </Modal>
  );
}
