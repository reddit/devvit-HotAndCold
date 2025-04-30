import { Context } from '@devvit/public-api';
import { API } from './api.js';

export type WordValidation = 'valid' | 'not-word' | 'not-lemma' | 'already-used';

/**
 * Validates a single word based on several criteria:
 * - Is it a real word recognized by the API?
 * - Is it in its lemma form (base dictionary form)?
 * - Has it already been used in a challenge (based on the provided usedWords)?
 */
export async function validateWord(
  word: string,
  context: Context,
  usedWords: string[] // Needs array for .includes check
): Promise<WordValidation> {
  const compare = await API.compareWordsCached({
    context,
    guessWord: word,
    // This can be any word, it doesn't matter we just want to know whether this is in lemma form and is a real word.!
    secretWord: 'banana',
  });
  if (compare.similarity == undefined) {
    return 'not-word';
  }

  if (compare.wordB !== compare.wordBLemma) {
    return 'not-lemma';
  }

  // Convert Set to Array if needed, or ensure input is Array
  if (usedWords.includes(word)) {
    return 'already-used';
  }

  return 'valid';
}
