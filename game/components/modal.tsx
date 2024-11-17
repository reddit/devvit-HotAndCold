import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

export const Modal = ({
  isOpen,
  onClose,
  children,
  clickAnywhereToClose = true,
}: {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  clickAnywhereToClose?: boolean;
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    // Save current active element and focus the modal
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      modalRef.current?.focus();
      document.addEventListener('keydown', handleKeyDown);
    } else {
      // Restore focus when modal closes
      previousActiveElement.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          ref={modalRef}
          initial={{
            opacity: 0,
          }}
          animate={{
            opacity: 1,
          }}
          exit={{
            opacity: 0,
          }}
          className="fixed inset-0 z-[100] flex h-full w-full items-center justify-center outline-none backdrop-blur-2xl"
          onClick={(e) => {
            if (clickAnywhereToClose && e.target === e.currentTarget) {
              onClose();
            }
          }}
          role="dialog"
          aria-modal="true"
          tabIndex={-1} // Makes the div focusable
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
          <button
            type="button"
            className="absolute right-3 top-3"
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
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
            >
              <path d="M10 10l4 4m0 -4l-4 4"></path>
              <path d="M12 3c7.2 0 9 1.8 9 9s-1.8 9 -9 9s-9 -1.8 -9 -9s1.8 -9 9 -9z"></path>
            </svg>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
