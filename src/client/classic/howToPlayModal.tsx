import { Modal } from '../shared/modal';
import { Logo } from '../shared/logo';
import { FlameIcon, SnowflakeIcon } from './icons';
import { howToPlayOpen, closeHowToPlay } from './state/howToPlay';

export function HowToPlayModal() {
  return (
    <Modal isOpen={howToPlayOpen.value} onClose={closeHowToPlay} labelledBy="how-to-play-title">
      <section className="w-[min(84vw,380px)] space-y-2 rounded-2xl bg-white p-4 text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <div className="flex items-center justify-between gap-3">
          <h2 id="how-to-play-title" className="text-base font-bold">
            How to Play
          </h2>
          <div className="h-6" role="img" aria-label="Hot and Cold">
            <Logo />
          </div>
        </div>
        <p className="text-xs leading-[16px] text-gray-600 dark:text-gray-300">
          Guess the secret word. <strong>Lower ranks mean closer meanings.</strong> Find #1 to win.
        </p>
        <div className="space-y-1 rounded-xl bg-gray-50 p-2 text-xs dark:bg-gray-800">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            Example Secret Word: <strong className="text-gray-900 dark:text-white">car</strong>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-cyan-700 dark:text-cyan-300 [&>svg]:h-5 [&>svg]:w-5">
              <SnowflakeIcon />
            </span>
            <strong className="flex-1">banana</strong>
            <span className="text-cyan-700 dark:text-cyan-300 [&>svg]:h-5 [&>svg]:w-5">
              #45,333
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-700 dark:text-orange-300 [&>svg]:h-5 [&>svg]:w-5">
              <FlameIcon />
            </span>
            <strong className="flex-1">tire</strong>
            <span className="text-orange-700 dark:text-orange-300 [&>svg]:h-5 [&>svg]:w-5">
              #344
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-orange-700 dark:text-orange-300 [&>svg]:h-5 [&>svg]:w-5">
              <FlameIcon />
            </span>
            <strong className="flex-1">truck</strong>
            <span className="text-orange-700 dark:text-orange-300 [&>svg]:h-5 [&>svg]:w-5">
              #12
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold [&_svg]:h-4 [&_svg]:w-4">
          <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            <FlameIcon /> Warmer
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200">
            <SnowflakeIcon /> Colder
          </span>
        </div>
        <p className="text-[11px] leading-[15px] text-gray-500 dark:text-gray-400">
          Warmer / Colder compares with your last guess. Your newest guess stays pinned.
        </p>
        <p className="text-[11px] leading-[15px] text-gray-500 dark:text-gray-400">
          <strong>Hint:</strong> After 5 guesses, adds a closer word; −30% score each.{' '}
          <strong>Give Up:</strong> After 10; confirms before revealing the answer.
        </p>
      </section>
    </Modal>
  );
}
