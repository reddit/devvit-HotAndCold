#!/usr/bin/env node --experimental-strip-types

import { createReadStream, promises as fsp, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = join(TOOLS_DIR, 'english-wordnet-2024.xml');
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const DEFAULT_OUTPUT = join(WORDS_NEW_DIR, 'word-list.txt');

async function writeWordList(outputPath: string, words: string[]) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const content = words.join('\n') + '\n';
  await fsp.writeFile(outputPath, content, 'utf8');
}

function parseLexicalEntryForLemma(xmlSnippet: string): string | null {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    // The snippet is a single <LexicalEntry>...</LexicalEntry>
    const obj = parser.parse(xmlSnippet);
    const entry = obj?.LexicalEntry;
    const lemma = entry?.Lemma;
    const wf: unknown = lemma?.writtenForm;
    if (typeof wf === 'string' && wf.trim()) return wf.trim().toLowerCase();
    return null;
  } catch {
    return null;
  }
}

async function extractFromWordnet(inputPath: string, outputPath: string) {
  const stream = createReadStream(inputPath, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buffer = '';
  const wordSet = new Set<string>();

  const startTag = '<LexicalEntry';
  const endTag = '</LexicalEntry>';
  let inEntry = false;

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (!inEntry) {
        const sIdx = buffer.indexOf(startTag);
        if (sIdx === -1) {
          // Keep tail for next chunk
          if (buffer.length > 1 << 20) {
            // Avoid unbounded growth when no entries found yet – keep last 1MB
            buffer = buffer.slice(-1 << 20);
          }
          break;
        }
        // Drop preceding content
        if (sIdx > 0) buffer = buffer.slice(sIdx);
        inEntry = true;
      }

      const eIdx = buffer.indexOf(endTag);
      if (eIdx === -1) break; // need more data

      const entryXml = buffer.slice(0, eIdx + endTag.length);
      buffer = buffer.slice(eIdx + endTag.length);
      inEntry = false;

      const word = parseLexicalEntryForLemma(entryXml);
      if (word) wordSet.add(word);
    }
  }

  // Best-effort process any remaining complete entry in buffer
  while (true) {
    const sIdx = buffer.indexOf(startTag);
    const eIdx = buffer.indexOf(endTag, sIdx === -1 ? 0 : sIdx);
    if (sIdx !== -1 && eIdx !== -1) {
      const entryXml = buffer.slice(sIdx, eIdx + endTag.length);
      buffer = buffer.slice(eIdx + endTag.length);
      const word = parseLexicalEntryForLemma(entryXml);
      if (word) wordSet.add(word);
    } else {
      break;
    }
  }

  const words = Array.from(wordSet);
  words.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  await writeWordList(outputPath, words);

  console.log(`✅ Extracted ${words.length.toLocaleString()} unique lemmas to ${outputPath}`);
}

async function main() {
  const [, , inArg, outArg] = process.argv;
  const input = inArg ?? DEFAULT_INPUT;
  const output = outArg ?? DEFAULT_OUTPUT;

  console.time('extract-wordnet');
  await extractFromWordnet(input, output);
  console.timeEnd('extract-wordnet');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
