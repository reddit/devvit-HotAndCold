import { Devvit } from '@devvit/public-api';
import { WordList } from '../core/wordList.js';
import { API } from '../core/api.js';

const addWordsToDictionaryFormId = Devvit.createForm(
  {
    acceptLabel: 'Create',
    title: 'Add Words to Dictionary',
    description:
      'Adds words to the dictionary to be used by challenges. If you want the word you are adding to be used immediately, select prepend.',
    fields: [
      {
        type: 'paragraph',
        label: 'Words',
        name: 'words',
        placeholder: 'Please separate words by a comma.',
        required: true,
      },
      {
        type: 'boolean',
        label: 'Prepend',
        name: 'prepend',
        placeholder: 'Prepend these words to the dictionary to be used first.',
      },
    ],
  },
  async ({ values: { prepend, words } }, context) => {
    const wordsToAdd = words.split(',').map((word: string) => word.trim());

    /**
     * Do a lemme check before adding the words to the dictionary
     */
    for (const word of wordsToAdd) {
      const compare = await API.compareWords({
        context,
        guessWord: word,
        // This can be any word, it doesn't matter we just want the lemma check!
        secretWord: 'banana',
      });

      if (compare.wordB !== compare.wordBLemma) {
        context.ui.showToast(
          `The word "${word}" is not the lemma form of the word "${compare.wordB}". Only lemma words are valid secret words. Please try again.`
        );
        return;
      }
    }

    wordsToAdd.forEach((word) => {
      // Don't wait, this just heats up the cache for the third party API
      void API.getWordConfig({ context, word });
    });

    const resp = await WordList.addToCurrentWordList({
      mode: prepend ? 'prepend' : 'append',
      redis: context.redis,
      words: wordsToAdd,
    });

    context.ui.showToast(
      `Added ${resp.wordsAdded} words to the dictionary. Skipped ${resp.wordsSkipped} words.`
    );
  }
);

Devvit.addMenuItem({
  label: 'HotAndCold: Add to Word List',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: (_event, context) => {
    context.ui.showForm(addWordsToDictionaryFormId);
  },
});
