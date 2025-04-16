import { Devvit } from '@devvit/public-api';
import { WordListManager } from '../core/wordList.js';
import { API } from '../core/api.js';

// TODO: Add a similar action/form for Hardcore mode word list

const addWordsToDictionaryFormId = Devvit.createForm(
  {
    acceptLabel: 'Create',
    title: 'Add Words to Classic Dictionary',
    description:
      'Adds words to the Classic mode dictionary. If you want the word you are adding to be used immediately, select prepend.',
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
      API.getWordConfig({ context, word });
    });

    // Use WordListManager for 'regular' mode
    const wordListManager = new WordListManager(context.redis, 'regular');
    const resp = await wordListManager.addToCurrentWordList({
      addMode: prepend ? 'prepend' : 'append',
      words: wordsToAdd,
    });

    context.ui.showToast(
      `Added ${resp.wordsAdded} words to the dictionary. Skipped ${resp.wordsSkipped} words.`
    );
  }
);

Devvit.addMenuItem({
  label: 'HotAndCold: Add to Classic Word List',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    context.ui.showForm(addWordsToDictionaryFormId);
  },
});
