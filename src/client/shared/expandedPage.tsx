import type { ComponentChildren } from 'preact';

/** One native scrolling surface, inside Reddit's expanded view. */
export function ExpandedPage({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <main
      aria-label={title}
      tabIndex={0}
      className="relative isolate h-[100dvh] overflow-y-auto bg-white text-gray-900 outline-none dark:bg-gray-950 dark:text-gray-100"
    >
      <div className="mx-auto w-full max-w-2xl px-4 pb-6 sm:px-6">
        <header className="sticky top-0 z-20 mb-4 border-b border-gray-200 bg-white py-3 dark:border-gray-700 dark:bg-gray-950">
          <h1 className="text-xl font-bold">{title}</h1>
        </header>
        {children}
      </div>
    </main>
  );
}
