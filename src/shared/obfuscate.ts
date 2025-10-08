/**
 * Obfuscate a word by replacing all non-space characters with random letters.
 * @param word - The word to obfuscate.
 * @returns The obfuscated word with random letters.
 */

export function obfuscate(word: string) {
  return word
    .split("")
    .map((char) => {
      if (char.trim() === "") return " ";
      const randomCharCode = Math.floor(Math.random() * 26) + 97; // 97-122 = a-z
      return String.fromCharCode(randomCharCode);
    })
    .join("");
}
