import type { ComponentChildren } from 'preact';

export function ScrollPanel({
  children,
  label,
  scrollable = true,
}: {
  children: ComponentChildren;
  label: string;
  scrollable?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={`min-h-0 flex-1 ${scrollable ? 'overflow-y-auto' : 'overflow-hidden'} focus-visible:outline-2 focus-visible:outline-cyan-600`}
      >
        <div>{children}</div>
      </div>
    </div>
  );
}
