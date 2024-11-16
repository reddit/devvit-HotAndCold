import { useEffect, useState } from 'react';
import { useSetPage } from '../hooks/usePage';
import { sendMessageToDevvit } from '../utils';
import { useDevvitListener } from '../hooks/useDevvitListener';
import { WordInput } from '../components/wordInput';
import { Guess, Guesses } from '../components/guesses';

export const SplashPage = () => {
  const [loading, setLoading] = useState(false);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [word, setWord] = useState('');
  const setPage = useSetPage();

  const wordSubmittedResponse = useDevvitListener('WORD_SUBMITTED_RESPONSE');

  useEffect(() => {
    if (!wordSubmittedResponse) return;

    // TODO: Handle duplicate

    if (wordSubmittedResponse.success) {
      if (wordSubmittedResponse.hasSolved) {
        setPage('win');
        // TODO: Need to handle solved
      } else {
        setGuesses((prev) => [
          ...prev,
          { similarity: wordSubmittedResponse.similarity, word: wordSubmittedResponse.word },
        ]);
      }
    } else {
      sendMessageToDevvit({
        type: 'SHOW_TOAST',
        string: wordSubmittedResponse.error,
      });
    }
  }, [wordSubmittedResponse]);

  console.log(guesses);

  return (
    <div className="flex flex-col gap-4 justify-center p-4">
      <h1 className="text-white">Hot And Cold</h1>
      <p className="text-white">Guess the secret word by meaning</p>
      <WordInput
        onChange={(e) => setWord(e.target.value)}
        onSubmit={() => {
          sendMessageToDevvit({
            type: 'WORD_SUBMITTED',
            value: word.trim().toLowerCase(),
          });
          // TODO Store previous in case we need to replenish due to errors
          setWord('');
          setLoading(true);
        }}
        placeholders={['Can you guess the word?', 'Try banana', 'Try dog']}
      />
      <Guesses items={guesses} />
    </div>
  );
};
