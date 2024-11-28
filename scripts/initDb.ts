import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import readline from "readline";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Config {
  batchSize: number;
  embedDimensions: number[];
  wordlistPath: string;
  embeddingDirBasePath: string;
  truncateMode: boolean;
  model: string;
}

interface WordRow {
  word: string;
  embeddings: Map<number, string>;
  synset_type: string;
  sense_count: number;
  part_of_speech: string;
  definition: string;
  synonyms: string;
  is_hint: boolean;
}

const config: Config = {
  batchSize: 1000,
  embedDimensions: [200, 300, 500, 1536, 3072],
  wordlistPath: path.join(
    __dirname,
    "..",
    "words",
    "output",
    "finalizedWordList.csv",
  ),
  embeddingDirBasePath: path.join(
    __dirname,
    "..",
    "words",
    "output",
    "openai",
    "embeddings",
  ),
  truncateMode: process.argv.includes("--truncate"),
  model: "text-embedding-3-large",
};

const client = new pg.Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  max: 10,
});

async function createSchema(): Promise<void> {
  if (config.truncateMode) {
    console.log('Truncate mode enabled. Dropping existing "words" table...');
    await client.query("DROP TABLE IF EXISTS words CASCADE");
    await client.query("DROP TABLE IF EXISTS cache CASCADE");
    await client.query("DROP TYPE IF EXISTS part_of_speech_enum CASCADE");
  }

  await client.query("SET statement_timeout = '1h'");

  const embeddingColumns = config.embedDimensions
    .map((dim) => `embedding_${dim} vector(${dim})`)
    .join(",\n      ");

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word VARCHAR(255),
      ${embeddingColumns},
      synset_type VARCHAR(255),
      sense_count INT,
      part_of_speech VARCHAR(255),
      definition TEXT,
      synonyms TEXT,
      is_hint BOOLEAN,
      UNIQUE(word)
    );
    
    CREATE TABLE IF NOT EXISTS cache (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE,
        data JSONB
      );
  `;

  await client.query(createTableQuery);
}

async function loadEmbeddings(dimension: number): Promise<Map<string, string>> {
  console.log(`Loading ${dimension}d embeddings...`);
  const embeddings = new Map<string, string>();

  for (let fileNum of [1, 2]) {
    try {
      const filePath = path.join(
        config.embeddingDirBasePath,
        `embeddings_${config.model}_${dimension}d_${fileNum}.jsonl`,
      );

      const fileStream = await fs.open(filePath);
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line) continue;
        const data = JSON.parse(line);
        const word = data.custom_id.replace(`-${dimension}d`, "");
        const vectorStr = `[${data.response.body.data[0].embedding.join(",")}]`;
        embeddings.set(word, vectorStr);
      }

      await fileStream.close();
    } catch (error) {
      console.error(
        `Error loading ${dimension}d embeddings file ${fileNum}:`,
        error,
      );
    }
  }

  return embeddings;
}

async function importWords(): Promise<void> {
  console.log("Loading embeddings...");
  const embeddingMaps = await Promise.all(
    config.embedDimensions.map(async (dim) => ({
      dimension: dim,
      map: await loadEmbeddings(dim),
    })),
  );

  console.log("Loading wordlist...");
  const fileStream = await fs.open(config.wordlistPath);
  const rl = readline.createInterface({
    input: fileStream.createReadStream(),
    crlfDelay: Infinity,
  });

  let batch: WordRow[] = [];
  let count = 0;

  for await (const line of rl) {
    if (line.startsWith("word,")) continue;

    const [
      word,
      ,
      pos,
      synset_type,
      ,
      synonyms,
      definition,
      sense_count,
      ,
      is_hint,
    ] = line.split(",");

    const embeddings = new Map<number, string>();

    for (const { dimension, map } of embeddingMaps) {
      embeddings.set(
        dimension,
        map.get(word) || `[${Array(dimension).fill(0).join(",")}]`,
      );
    }

    batch.push({
      word,
      embeddings,
      synset_type,
      sense_count: parseInt(sense_count) || 0,
      part_of_speech: pos,
      definition,
      synonyms,
      is_hint: is_hint === "1",
    });

    if (batch.length >= config.batchSize) {
      await insertBatch(batch);
      count += batch.length;
      console.log(`Processed ${count} words`);
      batch = [];
    }
  }

  if (batch.length > 0) {
    await insertBatch(batch);
    count += batch.length;
    console.log(`Processed ${count} words`);
  }
}

async function insertBatch(batch: WordRow[]): Promise<void> {
  // Build column names
  const columnNames = [
    "word",
    ...config.embedDimensions.map((dim) => `embedding_${dim}`),
    "synset_type",
    "sense_count",
    "part_of_speech",
    "definition",
    "synonyms",
    "is_hint",
  ];

  // Build parameterized values
  const values = batch.map((row, i) => {
    const offset = i * columnNames.length;
    return `(${columnNames.map((_, j) => `$${offset + j + 1}`).join(", ")})`;
  });

  // Generate the SQL query
  const query = `
    INSERT INTO words (${columnNames.join(", ")})
    VALUES ${values.join(", ")}
    ON CONFLICT (word) DO UPDATE SET
      ${
    config.embedDimensions.map((dim) =>
      `embedding_${dim} = EXCLUDED.embedding_${dim}`
    ).join(",\n      ")
  },
      synset_type = EXCLUDED.synset_type,
      sense_count = EXCLUDED.sense_count,
      part_of_speech = EXCLUDED.part_of_speech,
      definition = EXCLUDED.definition,
      synonyms = EXCLUDED.synonyms,
      is_hint = EXCLUDED.is_hint
  `;

  // Flatten batch into parameters array
  const parameters = batch.flatMap((row) => [
    row.word,
    ...config.embedDimensions.map((dim) => row.embeddings.get(dim)),
    row.synset_type,
    row.sense_count,
    row.part_of_speech,
    row.definition,
    row.synonyms,
    row.is_hint,
  ]);

  try {
    await client.query(query, parameters);
  } catch (error) {
    console.error("Failed query:", query);
    console.error(
      "First row of parameters:",
      parameters.slice(0, columnNames.length),
    );
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    console.log("Connecting to database...");
    await client.connect();

    console.log("Creating schema...");
    await createSchema();

    await client.query("ALTER TABLE words DISABLE TRIGGER ALL");

    try {
      console.log("Importing words...");
      await importWords();
    } catch (error) {
      console.error(`Error importing words:`, error);
    }

    await client.query("ALTER TABLE words ENABLE TRIGGER ALL");

    await client.query(`   
      CREATE INDEX IF NOT EXISTS idx_word ON words(word);
      CREATE INDEX IF NOT EXISTS idx_hint ON words(is_hint);
      `);

    console.log("Import completed successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
