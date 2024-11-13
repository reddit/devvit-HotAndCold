import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
console.log("Starting import...");

const client = new pg.Client({
  connectionString:
    "postgresql://postgres.jbbhyxtpholdwrxencjx:l1AZNZdDUHGv6KSh@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
});

async function createTableIfNotExists() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS words (
      id SERIAL PRIMARY KEY,
      word VARCHAR(255),
      embedding vector(1536),
      UNIQUE (word)
    );
    CREATE INDEX IF NOT EXISTS idx_word ON words (word);
  `;

  await client.query(createTableQuery);
}

console.log("Connecting to database...");

await client.connect();
await createTableIfNotExists();

console.log("Grabbing lookup.json...");

const lookup = JSON.parse(
  await fs.readFile(path.join(__dirname, "embeddings/lookup.json"), "utf-8"),
) as { [key: string]: { fileName: string; index: number } };

const fileCache: { [fileName: string]: any } = {};

const words = Object.keys(lookup);

console.log("Total words:", words.length);

const batchSize = 500;
for (let i = 166500; i < words.length; i += batchSize) {
  const batch = words.slice(i, i + batchSize);
  const values = [];

  for (const word of batch) {
    try {
      const fileName = lookup[word].fileName;
      if (!fileCache[fileName]) {
        const data = await fs.readFile(
          path.join(__dirname, "embeddings", fileName),
          "utf-8",
        );
        fileCache[fileName] = JSON.parse(data);
      }

      const item = fileCache[fileName][lookup[word].index];
      const embedding = item.embedding;

      values.push(`('${word}', '${JSON.stringify(embedding)}')`);
    } catch (e) {
      console.log(`Error processing word: ${word}`, e);
    }
  }

  if (values.length > 0) {
    const insertQuery = `
      INSERT INTO words (word, embedding)
      VALUES ${values.join(", ")}
      ON CONFLICT (word) DO NOTHING;
    `;

    try {
      await client.query(insertQuery);
      console.log("Inserted", Math.min(i + batchSize, words.length));
    } catch (e) {
      console.log("Error executing batch insert", e);
    }
  }
}

await client.end();
console.log("Import completed.");
