import { exitExpandedMode } from '@devvit/web/client';
import type { ComponentChildren } from 'preact';

/** One native scrolling surface, inside Reddit's expanded view. */
export function ExpandedPage({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <main
      aria-label={title}
      tabIndex={0}
      className="h-[100dvh] overflow-y-auto bg-white text-gray-900 outline-none dark:bg-gray-950 dark:text-gray-100"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-6 sm:px-6">
        <header className="sticky top-0 z-20 mb-4 flex items-center justify-between gap-3 border-b border-gray-200 bg-white py-3 dark:border-gray-700 dark:bg-gray-950">
          <h1 className="text-xl font-bold">{title}</h1>
          <button
            type="button"
            aria-label={`Close ${title}`}
            title="Return to Game"
            onClick={exitExpandedMode}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-cyan-500 dark:hover:bg-gray-800"
          >
            <svg
              aria-hidden="true"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </header>
        {children}
      </div>
    </main>
  );
}
