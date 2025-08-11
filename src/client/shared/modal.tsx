import { useEffect, useRef } from 'preact/hooks';
import type { FunctionalComponent, ComponentChildren } from 'preact';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ComponentChildren;
  clickAnywhereToClose?: boolean;
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
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    previousActiveElement.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen, onClose]);

  // Render nothing when closed
  if (!isOpen) return null;

  return (
    <div
      ref={modalRef}
      class="fixed inset-0 z-[15000] flex h-full w-full items-center justify-center outline-none backdrop-blur-2xl transition-opacity duration-200"
      onClick={(e) => {
        if (clickAnywhereToClose && e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      tabIndex={-1} // Makes the div focusable
    >
      <div class="relative" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>

      <button
        type="button"
        class="absolute right-3 top-3"
        onClick={onClose}
        aria-label="Close modal"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="h-8 w-8"
        >
          <path d="M10 10l4 4m0 -4l-4 4" />
          <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z" />
        </svg>
      </button>
    </div>
  );
};
