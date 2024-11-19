/**
 * An AI conversion of: https://github.com/words/wordnet for CSV output
 */

import { createReadStream, createWriteStream } from "fs";
import { join } from "path";
import { createInterface } from "readline";

// Type definitions
interface IndexData {
  [key: string]: IndexDefinition[];
}

interface DatabasePaths {
  [key: string]: string;
}

interface IndexDefinition {
  lemma: string;
  pos: string;
  synsetCount: number;
  pointerCount: number;
  pointers: string[];
  senseCount: number;
  tagSenseCount: number;
  synsetOffset: number;
  isComment?: boolean;
}

interface Word {
  word: string;
  lexId: number;
}

interface Pointer {
  pointerSymbol: string;
  synsetOffset: number;
  pos: string;
  sourceTargetHex: string;
  data?: WordData;
}

interface WordMeta {
  synsetOffset: number;
  lexFilenum: number;
  synsetType: string;
  wordCount: number;
  words: Word[];
  pointerCount: number;
  pointers: Pointer[];
}

interface WordData {
  glossary: string;
  meta: WordMeta;
}

const SPACE_CHAR = " ";
const KEY_PREFIX = "@__";
const EXTENSIONS_MAP: { [key: string]: string } = {
  "adj": "a",
  "adv": "r",
  "noun": "n",
  "verb": "v",
};

const SYNSET_TYPE_MAP: { [key: string]: string } = {
  "n": "noun",
  "v": "verb",
  "a": "adjective",
  "s": "adjective satellite",
  "r": "adverb",
};

let _index: IndexData = {};
let _dataPaths: DatabasePaths = {};

function toNumber(str: string, radix: number = 10): number {
  return parseInt(str, radix);
}

function getKey(word: string): string {
  // Normalize spaces to underscores and ensure proper formatting
  const normalized = word.trim().toLowerCase().replace(/\s+/g, "_");
  return `${KEY_PREFIX}${normalized}`;
}

async function readAtOffset(
  filePath: string,
  offset: number,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = createReadStream(filePath, {
      start: offset,
      end: offset + length - 1,
    });

    readable.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    readable.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    readable.on("error", reject);

    readable.on("close", () => {
      readable.destroy();
    });
  });
}

async function init(databaseDir: string): Promise<void> {
  const extensions = Object.keys(EXTENSIONS_MAP);

  // Store file paths for data files
  extensions.forEach((ext) => {
    _dataPaths[EXTENSIONS_MAP[ext]] = join(databaseDir, `data.${ext}`);
  });

  // Read index files sequentially
  for (const ext of extensions) {
    await readIndex(join(databaseDir, `index.${ext}`));
  }
}

function list(): string[] {
  return Object.keys(_index).map((key) => {
    return key.substring(KEY_PREFIX.length).replace(/_/g, SPACE_CHAR);
  });
}

async function lookup(
  word: string,
  skipPointers: boolean = false,
): Promise<WordData[]> {
  const key = getKey(word.replace(new RegExp(SPACE_CHAR, "g"), "_"));
  const definitions = _index[key];

  if (!definitions) {
    throw new Error(`No definition(s) found for "${word}"`);
  }

  const promises = definitions.map((definition) => {
    return readData(definition, skipPointers);
  });

  return Promise.all(
    promises.filter((p): p is Promise<WordData> => p !== undefined),
  );
}

async function readData(
  definition: IndexDefinition,
  skipPointers: boolean,
): Promise<WordData | undefined> {
  const { pos, synsetOffset } = definition;

  if (!pos) {
    return undefined;
  }

  const filePath = _dataPaths[pos];
  if (!filePath) {
    throw new Error(`No file path found for pos: ${pos}`);
  }

  const buffer = await readAtOffset(filePath, synsetOffset, 1024);
  const line = buffer.toString().split("\n")[0];
  return parseDataLine(line, skipPointers);
}

function readIndex(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const inputStream = createReadStream(filePath);
    const rl = createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    });

    rl.on("line", (line: string) => {
      const result = parseIndexLine(line);
      if (!result.isComment) {
        const key = getKey(result.lemma);
        if (!_index[key]) {
          _index[key] = [];
        }
        _index[key].push(result);
      }
    });

    rl.on("close", () => {
      inputStream.destroy();
      resolve();
    });

    rl.on("error", (err) => {
      inputStream.destroy();
      reject(err);
    });

    inputStream.on("error", (err) => {
      rl.close();
      reject(err);
    });
  });
}

function parseIndexLine(line: string): IndexDefinition {
  if (line.charAt(0) === SPACE_CHAR) {
    return { isComment: true } as IndexDefinition;
  }

  const [lemma, pos, synsetCount, ...parts] = line.split(SPACE_CHAR);
  const pointerCount = toNumber(parts.shift() || "0");

  const pointers: string[] = [];
  for (let index = 0; index < pointerCount; index++) {
    const pointer = parts.shift();
    if (pointer) pointers.push(pointer);
  }

  const [senseCount, tagSenseCount, synsetOffset] = parts;

  return {
    lemma,
    pos,
    synsetCount: toNumber(synsetCount),
    pointerCount,
    pointers,
    senseCount: toNumber(senseCount),
    tagSenseCount: toNumber(tagSenseCount),
    synsetOffset: toNumber(synsetOffset),
  };
}

async function parseDataLine(
  line: string,
  skipPointers: boolean,
): Promise<WordData> {
  const [metadataStr, glossaryStr = ""] = line.split("|");
  const metadata = metadataStr.split(" ");
  const glossary = glossaryStr.trim();

  const [synsetOffset, lexFilenum, synsetType, ...parts] = metadata;

  const wordCount = toNumber(parts.shift() || "0", 16);
  const words: Word[] = [];
  for (let wordIdx = 0; wordIdx < wordCount; wordIdx++) {
    words.push({
      word: parts.shift() || "",
      lexId: toNumber(parts.shift() || "0", 16),
    });
  }

  const pointerCount = toNumber(parts.shift() || "0");
  const pointers: Pointer[] = [];
  for (let pointerIdx = 0; pointerIdx < pointerCount; pointerIdx++) {
    pointers.push({
      pointerSymbol: parts.shift() || "",
      synsetOffset: parseInt(parts.shift() || "0", 10),
      pos: parts.shift() || "",
      sourceTargetHex: parts.shift() || "",
    });
  }

  if (!skipPointers) {
    const pointersData = await Promise.all(pointers.map((pointer) => {
      return readData({
        lemma: "",
        pos: pointer.pos,
        synsetOffset: pointer.synsetOffset,
        synsetCount: 0,
        pointerCount: 0,
        pointers: [],
        senseCount: 0,
        tagSenseCount: 0,
      }, true);
    }));

    pointersData.forEach((data, index) => {
      if (data) {
        pointers[index].data = data;
      }
    });
  }

  return {
    glossary,
    meta: {
      synsetOffset: toNumber(synsetOffset),
      lexFilenum: toNumber(lexFilenum),
      synsetType: SYNSET_TYPE_MAP[synsetType],
      wordCount,
      words,
      pointerCount,
      pointers,
    },
  };
}

function escapeCsvField(field: string | number): string {
  if (typeof field === "number") return field.toString();
  if (field.includes('"') || field.includes(",") || field.includes("\n")) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// And update the main export function with better word handling
export async function exportToCsv(
  inputPath: string,
  outputPath: string,
  outputFileName: string,
): Promise<void> {
  console.log("Initializing WordNet database...");
  await init(inputPath);

  const words = list();
  const outputFilePath = join(outputPath, outputFileName);
  const writeStream = createWriteStream(outputFilePath);

  // Write CSV header with all columns
  const header = [
    "word",
    "synset_offset",
    "lex_filenum",
    "pos",
    "synset_type",
    "words_in_synset",
    "synonyms",
    "definition",
    "pointer_count",
    "pointer_symbols",
    "pointer_synset_offsets",
    "pointer_pos",
    "pointer_source_target",
    "sense_count",
    "tag_sense_count",
  ].join(",") + "\n";

  writeStream.write(header);

  console.log("Processing words...");
  const chunkSize = 1000;
  let processedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (word) => {
        try {
          // Convert spaces back to underscore for lookup
          const lookupWord = word.replace(/\s+/g, "_");
          const key = getKey(lookupWord);
          let indexData = _index[key];

          if (!indexData || !indexData.length) {
            // Try alternate key formats
            const alternateKey1 = getKey(word); // original word with spaces
            const alternateKey2 = getKey(word.replace(/[\s-]+/g, "")); // no spaces or hyphens

            if (_index[alternateKey1]?.length) {
              indexData = _index[alternateKey1];
            } else if (_index[alternateKey2]?.length) {
              indexData = _index[alternateKey2];
            } else {
              skippedCount++;
              console.warn(
                `No index data found for word "${word}" (tried keys: ${key}, ${alternateKey1}, ${alternateKey2})`,
              );
              return;
            }
          }

          const definitions = await lookup(lookupWord);

          for (let j = 0; j < definitions.length; j++) {
            const def = definitions[j];
            const idx = indexData[j];

            if (!idx) {
              console.warn(
                `No matching index data for definition ${j} of word "${word}"`,
              );
              continue;
            }

            try {
              const synonyms = def.meta.words
                .map((w) => w.word.replace(/_/g, " ")) // Convert underscores back to spaces
                .filter((w) => w !== word)
                .join(";");

              const pointerSymbols = def.meta.pointers.map((p) =>
                p.pointerSymbol
              ).join(";");
              const pointerOffsets = def.meta.pointers.map((p) =>
                p.synsetOffset
              ).join(";");
              const pointerPos = def.meta.pointers.map((p) => p.pos).join(";");
              const pointerSourceTarget = def.meta.pointers.map((p) =>
                p.sourceTargetHex
              ).join(";");

              const fields = [
                escapeCsvField(word), // Use original word with spaces
                escapeCsvField(def.meta.synsetOffset),
                escapeCsvField(def.meta.lexFilenum),
                escapeCsvField(idx.pos),
                escapeCsvField(def.meta.synsetType),
                escapeCsvField(def.meta.wordCount),
                escapeCsvField(synonyms),
                escapeCsvField(def.glossary),
                escapeCsvField(def.meta.pointerCount),
                escapeCsvField(pointerSymbols),
                escapeCsvField(pointerOffsets),
                escapeCsvField(pointerPos),
                escapeCsvField(pointerSourceTarget),
                escapeCsvField(idx.senseCount),
                escapeCsvField(idx.tagSenseCount),
              ].join(",") + "\n";

              writeStream.write(fields);
              processedCount++;
            } catch (fieldError) {
              errorCount++;
              console.error(
                `Error processing fields for word "${word}", definition ${j}:`,
                fieldError,
              );
            }
          }
        } catch (error) {
          errorCount++;
          console.error(`Error processing word "${word}":`, error);
        }
      }),
    );

    console.log(
      `Processed ${
        Math.min(i + chunkSize, words.length)
      } of ${words.length} words ` +
        `(${processedCount} successes, ${errorCount} errors, ${skippedCount} skipped)`,
    );
  }

  writeStream.end();

  console.log(`
Output written to ${outputFilePath}
Final stats:
- Total words attempted: ${words.length}
- Successfully processed: ${processedCount}
- Errors: ${errorCount}
- Skipped: ${skippedCount}
`);
}
