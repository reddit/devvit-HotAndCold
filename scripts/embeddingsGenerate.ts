import dotenv from "dotenv";
dotenv.config();

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import * as csv from "csv-parse/sync";
import OpenAI from "openai";
import { createReadStream } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ===================== CONFIGURATION =====================
const CONFIG = {
  // File paths
  inputPath: join(__dirname, "../words/output/finalizedWordList.csv"),
  batchDir: join(__dirname, "../words/output/openai/batches"),

  // OpenAI configuration
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  modelDimensions: [50, 100, 1536], // Dimensions to request embeddings for

  // Batch configuration
  maxRequestsPerBatch: 45000, // Keep under OpenAI's 50k limit to be safe
  model: "text-embedding-3-large",
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: CONFIG.openaiApiKey,
});

// Track batch information
interface BatchInfo {
  dimension: number;
  batchNumber: number;
  batchId: string;
  fileId: string;
  requestCount: number;
  filePath: string;
  model: string;
}

const batchLog: BatchInfo[] = [];

async function readCsvFile(filePath: string) {
  const content = await fs.readFile(filePath, "utf-8");
  return csv.parse(content, {
    columns: true,
    skip_empty_lines: true,
  });
}

function createBatches(records: any[], dimensions: number) {
  const batches: any[][] = [[]];
  let currentBatchIndex = 0;
  let currentRequestCount = 0;

  for (const record of records) {
    // Create the request object
    const request = {
      custom_id: `${record.word}-${dimensions}d`,
      method: "POST",
      url: "/v1/embeddings",
      body: {
        model: "text-embedding-3-large",
        input: record.word,
        dimensions: dimensions,
      },
    };

    // Check if adding this request would exceed the limit
    if (currentRequestCount + 1 > CONFIG.maxRequestsPerBatch) {
      currentBatchIndex++;
      batches[currentBatchIndex] = [];
      currentRequestCount = 0;
    }

    batches[currentBatchIndex].push(request);
    currentRequestCount++;
  }

  return batches;
}

async function ensureDirectoryExists(dirPath: string) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

async function main() {
  try {
    // Ensure batch directory exists
    await ensureDirectoryExists(CONFIG.batchDir);

    // Read input CSV
    const records = await readCsvFile(CONFIG.inputPath);
    console.log(`Total words: ${records.length}`);

    // Process each dimension
    for (const dimensions of CONFIG.modelDimensions) {
      console.log(`\nProcessing ${dimensions}d embeddings...`);

      // Create batches for this dimension
      const batches = createBatches(records, dimensions);
      console.log(`Created ${batches.length} batches`);

      // Process each batch
      for (let i = 0; i < batches.length; i++) {
        const batchFilePath = join(
          CONFIG.batchDir,
          `batch_${CONFIG.model}_${dimensions}d_${i + 1}.jsonl`,
        );

        // Write batch to JSONL file
        await fs.writeFile(
          batchFilePath,
          batches[i].map((req) => JSON.stringify(req)).join("\n"),
        );

        // Upload the batch file
        const file = await openai.files.create({
          file: createReadStream(batchFilePath),
          purpose: "batch",
        });
        console.log(`Uploaded batch file ${i + 1}: ${file.id}`);

        // Create the batch
        const batch = await openai.batches.create({
          input_file_id: file.id,
          endpoint: "/v1/embeddings",
          completion_window: "24h",
        });
        console.log(`Created batch ${i + 1}: ${batch.id}`);
        console.log(`Status: ${batch.status}`);
        console.log(`Requests in batch: ${batches[i].length}`);

        // Log batch information
        batchLog.push({
          dimension: dimensions,
          batchNumber: i + 1,
          batchId: batch.id,
          fileId: file.id,
          requestCount: batches[i].length,
          filePath: batchFilePath,
          model: CONFIG.model,
        });

        // Optional: Add a small delay between batch submissions
        if (i < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    // Final summary output
    console.log("\n=== BATCH PROCESSING SUMMARY ===");
    console.table(batchLog);

    console.log("\n=== BATCH RETRIEVAL COMMANDS ===");
    console.log("// Copy these commands to check batch status:");
    batchLog.forEach(({ dimension, batchNumber, batchId }) => {
      console.log(`\n// ${dimension}d - Batch ${batchNumber}:`);
      console.log(`await openai.batches.retrieve("${batchId}");`);
    });

    console.log("\n=== JSON FORMAT FOR LATER USE ===");
    console.log("// Save this information for future reference:");
    console.log(JSON.stringify(batchLog, null, 2));
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
