import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export function useScrollNavigation(enabled = true) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ overflow: false, atTop: true, atBottom: true });
  useEffect(() => {
    const element = scrollRef.current;
    if (!enabled || !element) return;
    const measure = () => {
      const next = {
        overflow: element.scrollHeight > element.clientHeight + 2,
        atTop: element.scrollTop <= 2,
        atBottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
      };
      setPosition((previous) =>
        previous.overflow === next.overflow &&
        previous.atTop === next.atTop &&
        previous.atBottom === next.atBottom
          ? previous
          : next
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    element.addEventListener('scroll', measure);
    measure();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, [enabled]);
  const move = (direction: -1 | 1) => {
    const element = scrollRef.current;
    element?.scrollBy({
      top: direction * element.clientHeight * 0.75,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  return { scrollRef, ...position, move };
}

export function ScrollNavigation({
  controls,
  className = '',
}: {
  controls: ReturnType<typeof useScrollNavigation>;
  className?: string;
}) {
  if (!controls.overflow) return null;
  const button =
    'rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-sm disabled:opacity-40 dark:bg-gray-800 dark:text-gray-100';
  return (
    <nav
      aria-label="Scroll Controls"
      className={`flex shrink-0 items-center justify-center gap-2 ${className}`}
    >
      <button
        type="button"
        className={button}
        disabled={controls.atTop}
        onClick={() => controls.move(-1)}
      >
        ↑ Scroll Up
      </button>
      <button
        type="button"
        className={button}
        disabled={controls.atBottom}
        onClick={() => controls.move(1)}
      >
        ↓ Scroll Down
      </button>
    </nav>
  );
}

export function ScrollPanel({ children, label }: { children: ComponentChildren; label: string }) {
  const controls = useScrollNavigation();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={controls.scrollRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-cyan-600"
      >
        <div>{children}</div>
      </div>
      <ScrollNavigation controls={controls} />
    </div>
  );
}
