import type { ComponentChildren } from 'preact';

/** One native scrolling surface, inside Reddit's expanded view. */
export function ExpandedPage({
  title,
  children,
  icon,
}: {
  title: string;
  children: ComponentChildren;
  icon?: ComponentChildren;
}) {
  return (
    <main
      aria-label={title}
      tabIndex={0}
      className="relative isolate h-[100dvh] overflow-y-auto bg-white text-gray-900 outline-none dark:bg-gray-950 dark:text-gray-100"
    >
      <header className="sticky top-0 z-20 mb-4 border-b border-gray-200/60 bg-white/70 backdrop-blur-xl dark:border-gray-700/60 dark:bg-gray-950/70">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2.5 px-4 py-3 sm:px-6">
          {icon && (
            <span aria-hidden="true" className="text-cyan-800 dark:text-cyan-200">
              {icon}
            </span>
          )}
          <h1 className="text-xl font-bold">{title}</h1>
        </div>
        <div
          aria-hidden="true"
          className="h-0.5 bg-linear-to-r from-cyan-400 via-amber-400 to-orange-600"
        />
      </header>
      <div className="mx-auto w-full max-w-2xl px-4 pb-6 sm:px-6">{children}</div>
    </main>
  );
}
