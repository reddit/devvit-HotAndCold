#!/usr/bin/env node --experimental-strip-types

import { createReadStream, createWriteStream, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const INPUT_XML = join(TOOLS_DIR, 'english-wordnet-2024.xml');
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const OUTPUT = join(WORDS_NEW_DIR, 'extracted.txt');

function parseLexicalEntryForLemma(xmlSnippet: string): string | null {
  try {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
    const obj = parser.parse(xmlSnippet);
    const wf: unknown = obj?.LexicalEntry?.Lemma?.writtenForm;
    if (typeof wf === 'string' && wf.trim()) return wf.trim();
    return null;
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync(WORDS_NEW_DIR, { recursive: true });
  const out = createWriteStream(OUTPUT, { encoding: 'utf8' });

  const stream = createReadStream(INPUT_XML, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buffer = '';
  const startTag = '<LexicalEntry';
  const endTag = '</LexicalEntry>';
  let inEntry = false;

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (!inEntry) {
        const sIdx = buffer.indexOf(startTag);
        if (sIdx === -1) {
          if (buffer.length > 1 << 20) buffer = buffer.slice(-1 << 20);
          break;
        }
        if (sIdx > 0) buffer = buffer.slice(sIdx);
        inEntry = true;
      }

      const eIdx = buffer.indexOf(endTag);
      if (eIdx === -1) break;

      const entryXml = buffer.slice(0, eIdx + endTag.length);
      buffer = buffer.slice(eIdx + endTag.length);
      inEntry = false;

      const word = parseLexicalEntryForLemma(entryXml);
      if (word) out.write(word + '\n');
    }
  }

  await new Promise<void>((resolve) => {
    out.end();
    out.on('finish', () => resolve());
  });

  console.log(`✅ Extracted raw lemmas to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
