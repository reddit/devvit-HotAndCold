// @ts-expect-error - Too lazy to really type this
import rawWordList from './word-list.txt?raw';

export const wordsOfTheDay = (rawWordList as string)
  .trim()
  .split('\n')
  .map((word) => word.trim());
