import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import OpenAI from "openai";
import readline from "readline";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  errorDirPath: path.join(
    __dirname,
    "..",
    "words",
    "output",
    "openai",
    "errors",
  ),
  batchSize: 50,
  retryDelay: 1000,
};

const client = new pg.Client({
  connectionString: process.env.PG_CONNECTION_STRING,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ErrorRecord {
  custom_id: string;
  response: {
    status_code: number;
    body: any;
  };
}

async function processErrorFile(filePath: string): Promise<void> {
  const filename = path.basename(filePath);
  const [, model, dimStr] = filename.match(/errors_(.*?)_(\d+)d_\d+/) || [];
  const dimension = parseInt(dimStr);

  if (!model || !dimension) {
    throw new Error(`Invalid filename format: ${filename}`);
  }

  const fileStream = await fs.open(filePath);
  const rl = readline.createInterface({
    input: fileStream.createReadStream(),
    crlfDelay: Infinity,
  });

  let batch: ErrorRecord[] = [];
  let count = 0;

  for await (const line of rl) {
    if (!line) continue;
    const record: ErrorRecord = JSON.parse(line);
    batch.push(record);

    if (batch.length >= config.batchSize) {
      await processBatch(batch, model, dimension);
      count += batch.length;
      console.log(`Processed ${count} errors from ${filename}`);
      batch = [];
      await new Promise((resolve) => setTimeout(resolve, config.retryDelay));
    }
  }

  if (batch.length > 0) {
    await processBatch(batch, model, dimension);
    count += batch.length;
    console.log(`Processed ${count} errors from ${filename}`);
  }

  await fileStream.close();
}

async function processBatch(
  batch: ErrorRecord[],
  model: string,
  dimension: number,
): Promise<void> {
  const updates: { word: string; embedding: number[] }[] = [];

  for (const record of batch) {
    const word = record.custom_id.replace(`-${dimension}d`, "");

    try {
      const embedding = await openai.embeddings.create({
        model,
        input: word,
        dimensions: dimension,
      });

      updates.push({
        word,
        embedding: embedding.data[0].embedding,
      });
    } catch (error) {
      console.error(`Failed to get embedding for ${word}:`, error);
    }
  }

  if (updates.length > 0) {
    await updateDatabase(updates, dimension);
  }
}

async function updateDatabase(
  updates: { word: string; embedding: number[] }[],
  dimension: number,
): Promise<void> {
  const query = `
    UPDATE words
    SET embedding_${dimension} = $2::vector
    WHERE word = $1
  `;

  for (const { word, embedding } of updates) {
    try {
      await client.query(query, [word, `[${embedding.join(",")}]`]);
    } catch (error) {
      console.error(`Failed to update database for ${word}:`, error);
    }
  }
}

async function main(): Promise<void> {
  try {
    await client.connect();

    const files = await fs.readdir(config.errorDirPath);
    const errorFiles = files.filter((f) =>
      f.startsWith("errors_") && f.endsWith(".jsonl")
    );

    for (const file of errorFiles) {
      console.log(`Processing ${file}...`);
      await processErrorFile(path.join(config.errorDirPath, file));
    }
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
