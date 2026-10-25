import { Modal } from '../shared/modal';
import { Logo } from '../shared/logo';
import { FlameIcon, SnowflakeIcon } from './icons';
import { howToPlayOpen, closeHowToPlay } from './state/howToPlay';

export function HowToPlayModal() {
  return (
    <Modal isOpen={howToPlayOpen.value} onClose={closeHowToPlay} labelledBy="how-to-play-title">
      <section className="w-[min(80vw,380px)] space-y-3 bg-white p-5 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="how-to-play-title" className="text-lg font-bold">
            How to Play
          </h2>
          <div className="h-5" role="img" aria-label="Hot and Cold">
            <Logo />
          </div>
        </div>
        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
          Guess the secret word. Each guess has a rank: <strong>lower numbers are closer</strong>.
          Find #1 to win.
        </p>
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="pb-1 text-xs text-gray-500 dark:text-gray-400">
            Example Secret Word: <strong className="text-gray-900 dark:text-white">car</strong>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-cyan-700 dark:text-cyan-300">
              <SnowflakeIcon />
            </span>
            <strong className="flex-1">banana</strong>
            <span className="text-cyan-700 dark:text-cyan-300">#45,333 · Far</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-700 dark:text-orange-300">
              <FlameIcon />
            </span>
            <strong className="flex-1">tire</strong>
            <span className="text-orange-700 dark:text-orange-300">#344 · Closer</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-700 dark:text-orange-300">
              <FlameIcon />
            </span>
            <strong className="flex-1">truck</strong>
            <span className="text-orange-700 dark:text-orange-300">#12 · Very Close</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            <FlameIcon /> Warmer
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-1 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
            <SnowflakeIcon /> Colder
          </span>
        </div>
        <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Warmer or colder compares with your previous guess. The newest guess stays pinned above
          your history.
        </p>
      </section>
    </Modal>
  );
}
