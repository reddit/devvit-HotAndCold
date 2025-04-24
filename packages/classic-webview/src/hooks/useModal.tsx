import { createContext, useContext, useState } from 'react';

export type Modal = 'unlock-hardcore' | 'how-to-play' | 'score-breakdown' | undefined;

type ModalContext = {
  modal: Modal;
  setModal: React.Dispatch<React.SetStateAction<Modal | undefined>>;
};

const modalContext = createContext<ModalContext | null>(null);

export const ModalContextProvider = (props: { children: React.ReactNode }) => {
  const [modal, setModal] = useState<Modal>('unlock-hardcore');

  return (
    <modalContext.Provider value={{ modal, setModal }}>{props.children}</modalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(modalContext);
  if (context === null) {
    throw new Error('useModal must be used within a ModalContextProvider');
  }
  return context;
};
