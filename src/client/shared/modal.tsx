import { useEffect, useRef } from 'preact/hooks';
import type { FunctionalComponent, ComponentChildren } from 'preact';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  clickAnywhereToClose?: boolean;
  labelledBy?: string;
  closeDisabled?: boolean;
}

/**
 * Accessible modal dialog using **Preact** + hooks (no Framer Motion).
 * ‑ Focus is trapped, ESC closes, optional backdrop‑click dismissal.
 */
export const Modal: FunctionalComponent<ModalProps> = ({
  isOpen,
  onClose,
  children,
  clickAnywhereToClose = true,
  labelledBy,
  closeDisabled = false,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  // Keep a stable reference to the latest onClose without retriggering the open effect
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current?.();
      if (event.key === 'Tab') {
        const buttons = Array.from(
          modalRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled):not([tabindex="-1"]), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
          ) ?? []
        ).filter((element) => element.getClientRects().length > 0);
        const first = buttons[0];
        const last = buttons.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !buttons.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !buttons.includes(document.activeElement as HTMLElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };

    previousActiveElement.current = document.activeElement as HTMLElement;
    const el = modalRef.current;
    if (el && document.activeElement !== el && !el.contains(document.activeElement)) {
      el.focus();
    }
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen]);

  // Render nothing when closed
  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      class="fixed inset-0 z-[15000] flex h-full w-full items-center justify-center bg-black/15 p-6 backdrop-blur-md outline-none"
      onClick={(e) => {
        if (clickAnywhereToClose && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1} // Makes the div focusable
    >
      <div class="relative min-h-0 max-w-full rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div>{children}</div>
      </div>

      <button
        type="button"
        class="absolute top-2 right-2 inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-300 bg-white/90 text-gray-700 transition-colors hover:border-cyan-500 hover:bg-cyan-50 focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:outline-none disabled:opacity-50 dark:border-gray-600 dark:bg-gray-900/90 dark:text-gray-200 dark:hover:bg-gray-800"
        onClick={onClose}
        aria-label="Close modal"
        disabled={closeDisabled}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-6 w-6"
        >
          <path d="m6 6 12 12M6 18 18 6" />
        </svg>
      </button>
    </div>
  );
};
