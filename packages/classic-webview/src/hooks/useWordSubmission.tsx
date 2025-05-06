import { createContext, useContext, ReactNode, useState } from 'react';

type WordSubmissionStateContext = {
  isSubmitting: boolean;
  setIsSubmitting: (isSubmitting: boolean) => void;
};

const WordSubmissionContext = createContext<WordSubmissionStateContext | null>(null);

export const WordSubmissionProvider = ({ children }: { children: ReactNode }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <WordSubmissionContext.Provider value={{ isSubmitting, setIsSubmitting }}>
      {children}
    </WordSubmissionContext.Provider>
  );
};

export const useWordSubmission = () => {
  const context = useContext(WordSubmissionContext);
  if (context === null) {
    throw new Error('useWordSubmission must be used within a WordSubmissionProvider');
  }
  return context;
};
