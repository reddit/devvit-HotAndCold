import { useState, useRef, useEffect, createContext, useContext, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type ConfirmationOptions = {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
};

type ConfirmationDialogContextType = {
  showConfirmation: (options: ConfirmationOptions) => Promise<{ confirmed: boolean }>;
};

const ConfirmationDialogContext = createContext<ConfirmationDialogContextType | undefined>(
  undefined
);

const Alert = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Continue',
  cancelText = 'Cancel',
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    previousActiveElement.current = document.activeElement as HTMLElement;
    modalRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus();
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          ref={modalRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1500] flex h-full w-full items-center justify-center outline-none backdrop-blur-2xl"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              onClose();
            }
          }}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="alert-title"
          aria-describedby="alert-description"
          tabIndex={-1}
        >
          <div className="px-2">
            <div
              className="relative mx-auto min-w-[300px] max-w-[420px] rounded-lg border border-gray-800 bg-gray-900 p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4">
                <h2 id="alert-title" className="text-lg font-semibold text-white">
                  {title}
                </h2>
                <p id="alert-description" className="mt-2 text-sm text-gray-300">
                  {description}
                </p>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  onClick={onClose}
                >
                  {cancelText}
                </button>
                <button
                  type="button"
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                >
                  {confirmText}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const ConfirmationDialogProvider = ({ children }: { children: React.ReactNode }) => {
  const [confirmationState, setConfirmationState] = useState<{
    isOpen: boolean;
    options: ConfirmationOptions | null;
    resolve: ((value: { confirmed: boolean }) => void) | null;
  }>({
    isOpen: false,
    options: null,
    resolve: null,
  });

  const showConfirmation = useCallback((options: ConfirmationOptions) => {
    return new Promise<{ confirmed: boolean }>((resolve) => {
      setConfirmationState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleClose = () => {
    confirmationState.resolve?.({ confirmed: false });
    setConfirmationState({
      isOpen: false,
      options: null,
      resolve: null,
    });
  };

  const handleConfirm = () => {
    confirmationState.resolve?.({ confirmed: true });
    setConfirmationState({
      isOpen: false,
      options: null,
      resolve: null,
    });
  };

  return (
    <ConfirmationDialogContext.Provider value={{ showConfirmation }}>
      {children}
      {confirmationState.isOpen && confirmationState.options && (
        <Alert
          isOpen={confirmationState.isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title={confirmationState.options.title}
          description={confirmationState.options.description}
          confirmText={confirmationState.options.confirmText}
          cancelText={confirmationState.options.cancelText}
        />
      )}
    </ConfirmationDialogContext.Provider>
  );
};

export const useConfirmation = () => {
  const context = useContext(ConfirmationDialogContext);
  if (!context) {
    throw new Error('useConfirmation must be used within a ConfirmationDialogProvider');
  }
  return context;
};
