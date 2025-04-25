import { createContext, useContext, useState } from 'react';
import { UnlockHardcoreModal } from '../components/UnlockHardcoreModal';
import { HowToPlayModal } from '../components/howToPlayModal';
import { ScoreBreakdownModal } from '../components/scoreBreakdownModal';

export type ModalType = 'unlock-hardcore' | 'how-to-play' | 'score-breakdown';

type ModalContext = {
  modal: ModalType | undefined;
  /** set to `undefined` to indicate that no modal is showing */
  showModal: (m: ModalType) => void;
  closeModal: () => void;
};

const modalContext = createContext<ModalContext | null>(null);

export const ModalContextProvider = (props: { children: React.ReactNode }) => {
  const [modal, setModal] = useState<ModalType | undefined>(undefined);

  const closeModal = () => setModal(undefined);

  const Modal: React.FC = () => {
    switch (modal) {
      case 'unlock-hardcore':
        return <UnlockHardcoreModal isOpen onClose={closeModal} />;
      case 'how-to-play':
        return <HowToPlayModal isOpen onClose={closeModal} />;
      case 'score-breakdown':
        return <ScoreBreakdownModal isOpen clickAnywhereToClose={false} onClose={closeModal} />;
      default:
        return <></>;
    }
  };

  return (
    <modalContext.Provider
      value={{ modal: modal, showModal: (m: ModalType) => setModal(m), closeModal }}
    >
      {modal && <Modal />}
      {props.children}
    </modalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(modalContext);
  if (context === null) {
    throw new Error('useModal must be used within a ModalContextProvider');
  }
  return context;
};
