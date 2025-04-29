import { Context, Devvit } from '@devvit/public-api';
import { ChallengeToWordService } from '../core/challengeToWord.js';
import { GameMode } from '@hotandcold/classic-shared';
import { DEFAULT_WORD_LIST, HARDCORE_WORD_LIST } from '../constants.js';
import { validateWord } from '../core/wordValidation.js';

/** Looks through the default word list for a given mode and validates a variety of things:
 * - Checks for duplicates within the list
 * - Checks for words that are not real words
 * - Checks for words that are not the lemma form
 * - Checks for words that have already been used in a challenge
 * - Logs progress
 * - Logs completion
 *
 * This is a long running operation, and our caching layer has issues, and devvit tends to kill long running operations.
 * So we take a starting index and only validate words from that index onward.
 */
async function validateWordListForMode(
  mode: GameMode,
  wordList: string[],
  context: Context,
  usedWords: Set<string>,
  startingIndex: number = 0
): Promise<void> {
  console.log(
    `\n--- Validating ${mode} Word List (${wordList.length} words), starting checks from index ${startingIndex} ---`
  );
  const seenWords = new Map<string, number[]>();
  const totalWords = wordList.length;
  const logInterval = 10;

  if (startingIndex >= totalWords) {
    console.log(
      `Starting index (${startingIndex}) is out of bounds. Skipping word validation checks, but still checking for internal duplicates.`
    );
    startingIndex = totalWords;
  }

  for (const [index, word] of wordList.entries()) {
    const existingIndices = seenWords.get(word);
    if (existingIndices) {
      existingIndices.push(index);
    } else {
      seenWords.set(word, [index]);
    }

    if (index >= startingIndex) {
      const validationResult = await validateWord(word, context, Array.from(usedWords));

      if (validationResult === 'not-word') {
        console.error(`ERROR (${mode}): "${word}" (index ${index}) is not a real word.`);
      } else if (validationResult === 'not-lemma') {
        console.error(`ERROR (${mode}): "${word}" (index ${index}) is not the lemma form.`);
      } else if (validationResult === 'already-used') {
        console.warn(
          `WARN (${mode}): "${word}" (index ${index}) has already been used in a challenge.`
        );
      }

      const currentWordNumber = index + 1;
      if (currentWordNumber % logInterval === 0 || currentWordNumber === totalWords) {
        console.log(
          `(${mode}) Progress: Reached word ${currentWordNumber}/${totalWords} (Checks started at index ${startingIndex})...`
        );
      }
    }
  }

  let duplicatesFound = false;
  for (const [word, indices] of seenWords.entries()) {
    if (indices.length > 1) {
      console.warn(`DUPLICATE (${mode}): "${word}" found at indices: ${indices.join(', ')}.`);
      duplicatesFound = true;
    }
  }
  if (!duplicatesFound) {
    console.log(`(${mode}): No duplicate words found within this list.`);
  }

  console.log(
    `--- Finished Validating ${mode} Word List (Checks started at index ${startingIndex}) ---`
  );
}

type WordOccurrence = {
  mode: GameMode;
  indices: number[];
};

/**
 *  Checks for duplicates across lists.
 */
function findCrossListDuplicates(regularList: string[], hardcoreList: string[]): void {
  console.log('\n--- Checking for Duplicates Across Lists ---');
  const wordMap = new Map<string, WordOccurrence[]>();

  const addOccurrence = (word: string, index: number, mode: GameMode) => {
    const occurrences = wordMap.get(word) || [];
    const modeEntry = occurrences.find((occ) => occ.mode === mode);

    if (modeEntry) {
      modeEntry.indices.push(index);
    } else {
      occurrences.push({ mode, indices: [index] });
      if (occurrences.length === 1) {
        wordMap.set(word, occurrences);
      }
    }
  };

  regularList.forEach((word, index) => addOccurrence(word, index, 'regular'));
  hardcoreList.forEach((word, index) => addOccurrence(word, index, 'hardcore'));

  let crossListDuplicates = 0;
  for (const [word, occurrences] of wordMap.entries()) {
    if (occurrences.length > 1) {
      const details = occurrences
        .map((occ) => `${occ.mode} (indices: ${occ.indices.join(', ')})`)
        .join(' and ');
      console.warn(`DUPLICATE (Across Lists): "${word}" found in ${details}.`);
      crossListDuplicates++;
    }
  }

  if (crossListDuplicates === 0) {
    console.log('No duplicates found across Regular and Hardcore lists.');
  } else {
    console.log(`${crossListDuplicates} duplicate words found across lists.`);
  }
}

/**
 * Handles users asking to validate a word list for a given mode.
 *
 * This is a long running operation, and our caching layer has issues, and devvit tends to kill long running operations.
 * So we take a starting index and only validate words from that index onward.
 */
async function handleValidateListForMode(
  context: Context,
  mode: GameMode,
  startingIndex: number = 0
): Promise<void> {
  const wordList = mode === 'regular' ? DEFAULT_WORD_LIST : HARDCORE_WORD_LIST;

  context.ui.showToast(
    `Starting ${mode} word list validation from index ${startingIndex}... Check logs.`
  );
  console.log(
    `Starting validation of ${mode.toUpperCase()} default word list from index ${startingIndex}...`
  );

  const challengeService = new ChallengeToWordService(context.redis, mode);
  const usedWordsList = await challengeService.getAllUsedWords({});
  const usedWordsSet = new Set(usedWordsList);

  await validateWordListForMode(mode, wordList, context, usedWordsSet, startingIndex);

  console.log(
    `\nValidation Finished for mode: ${mode} (Checks started at index ${startingIndex}).`
  );
  context.ui.showToast(
    `Word list validation complete for: ${mode} (Checks started at index ${startingIndex}). Check logs.`
  );
}

/**
 * Handles users asking to check for duplicates across lists.
 */
function handleCheckCrossDuplicates(context: Context): void {
  context.ui.showToast('Checking for cross-list duplicates... Check logs.');
  findCrossListDuplicates(DEFAULT_WORD_LIST, HARDCORE_WORD_LIST);
  context.ui.showToast('Cross-list duplicate check complete. Check logs.');
}

/**
 * Creates a menu action for validating a word list for a given mode.
 */
function createValidationMenuAction(mode: GameMode): void {
  const modeTitleCase = mode.charAt(0).toUpperCase() + mode.slice(1);
  const formTitle = `Validate ${modeTitleCase} Word List`;
  const formDescription = `Validates the ${mode.toUpperCase()} default list for correctness . Check logs.`;
  const menuItemLabel = `HotAndCold: Validate ${modeTitleCase} Word List`;
  const acceptLabel = `Run ${modeTitleCase} Validation`;

  const validateListFormId = Devvit.createForm(
    {
      title: formTitle,
      description: formDescription,
      acceptLabel: acceptLabel,
      fields: [
        {
          name: 'startingIndex',
          label: 'Starting Index (Optional)',
          helpText: 'Start validation checks from this word index (0-based). Defaults to 0.',
          type: 'number',
          required: false,
          defaultValue: 0,
        },
      ],
    },
    (event, context) => {
      const startingIndex =
        Number(event.values.startingIndex) >= 0 ? Number(event.values.startingIndex) : 0;
      void handleValidateListForMode(context, mode, startingIndex);
    }
  );

  Devvit.addMenuItem({
    label: menuItemLabel,
    location: 'subreddit',
    forUserType: 'moderator',
    onPress: (_event, context) => {
      context.ui.showForm(validateListFormId);
    },
  });
}

createValidationMenuAction('regular');
createValidationMenuAction('hardcore');

const checkCrossDuplicatesFormId = Devvit.createForm(
  {
    title: 'Check Cross-List Duplicates',
    description:
      'Checks for words that appear in BOTH the regular and hardcore default word lists (constants.ts). Check logs for output.',
    acceptLabel: 'Check Duplicates',
    fields: [],
  },
  (_event, context) => {
    void handleCheckCrossDuplicates(context);
  }
);

Devvit.addMenuItem({
  label: 'HotAndCold: Check Cross-List Duplicates',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: (_event, context) => {
    context.ui.showForm(checkCrossDuplicatesFormId);
  },
});
