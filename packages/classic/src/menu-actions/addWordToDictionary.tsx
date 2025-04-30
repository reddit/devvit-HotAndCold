import { Context, Devvit } from '@devvit/public-api';
import { WordListService } from '../core/wordList.js';
import { API } from '../core/api.js';
import { ChallengeToWordService } from '../core/challengeToWord.js';
import { GameMode } from '@hotandcold/classic-shared';
import { validateWord } from '../core/wordValidation.js';

createAddWordsMenuAction();

/** Validates words and then adds them to redis if all words given are valid.*/
async function validateAndAddWords(
  words: string,
  prepend: boolean,
  context: Context,
  mode: GameMode
): Promise<void> {
  const wordsToAdd = words.split(',').map((word: string) => word.trim());

  const usedWords: string[] = await new ChallengeToWordService(context.redis, mode).getAllUsedWords(
    {}
  );

  /**
   * Do a lemme check before adding the words to the dictionary
   */
  for (const word of wordsToAdd) {
    const validationResult = await validateWord(word, context, usedWords);

    if (validationResult === 'not-word') {
      context.ui.showToast(`The word "${word}" is not a real word. Please try again.`);
      return;
    }

    if (validationResult === 'not-lemma') {
      context.ui.showToast(
        `The word "${word}" is not the lemma form of the word. Only lemma words are valid secret words. Please try again.`
      );
      return;
    }

    if (validationResult === 'already-used') {
      context.ui.showToast(
        `The word "${word}" is already used in a challenge in ${mode} mode. Please try again.`
      );
      return;
    }
  }

  wordsToAdd.forEach((word) => {
    // Don't wait, this just heats up the cache for the third party API
    void API.getWordConfig({ context, word });
  });

  const resp = await new WordListService(context.redis, mode).addToCurrentWordList({
    mode: prepend ? 'prepend' : 'append',
    words: wordsToAdd,
  });

  context.ui.showToast(
    `Added ${resp.wordsAdded} words to the ${mode} dictionary. Skipped ${resp.wordsSkipped} words.`
  );
}

function createAddWordsMenuAction(): void {
  const formTitle = 'Add Words to Dictionary';
  const formDescription =
    'Adds words to the dictionary to be used by challenges. If you want the word you are adding to be used immediately, select prepend.';
  const menuItemLabel = 'HotAndCold: Add to Word List';

  const addWordsFormId = Devvit.createForm(
    {
      acceptLabel: 'Add Words',
      title: formTitle,
      description: formDescription,
      fields: [
        {
          type: 'paragraph',
          label: 'Words',
          name: 'words',
          placeholder: 'Please separate words by a comma.',
          required: true,
        },
        {
          type: 'select',
          label: 'Game Mode',
          name: 'mode',
          options: [
            { label: 'Regular', value: 'regular' },
            { label: 'Hardcore', value: 'hardcore' },
          ],
          defaultValue: ['regular'],
          required: true,
        },
        {
          type: 'boolean',
          label: 'Prepend',
          name: 'prepend',
          defaultValue: false,
          helpText: 'Prepend these words to the dictionary to be used first.',
        },
      ],
    },
    async (event, context) => {
      // In practice users can only select one mode, but the type system doesn't know that.
      const selectedMode = Array.isArray(event.values.mode)
        ? event.values.mode[0]
        : event.values.mode;
      await validateAndAddWords(
        event.values.words,
        event.values.prepend,
        context,
        selectedMode as GameMode
      );
    }
  );

  Devvit.addMenuItem({
    label: menuItemLabel,
    location: 'subreddit',
    forUserType: 'moderator',
    onPress: (_event, context) => {
      context.ui.showForm(addWordsFormId);
    },
  });
}
