import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Batch information from previous run
const BATCH_INFO = [
  {
    "dimension": 50,
    "batchNumber": 1,
    "batchId": "batch_673d30c76130819080ca1fe4f2c90f21",
    "fileId": "file-LSsWMocbOORXPScoWiOWwqXP",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 50,
    "batchNumber": 2,
    "batchId": "batch_673d30cc84e0819083ca965634acdd99",
    "fileId": "file-mGxdYcHWn8JuTeRADPFDfrXE",
    "requestCount": 30591,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 1,
    "batchId": "batch_673d30d06aac8190abf77835ebc3963e",
    "fileId": "file-cSxZsLczUERN6Rr1zD212gIU",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 2,
    "batchId": "batch_673d30d43be48190ab15afeeaa005f21",
    "fileId": "file-0M786jnMxwME9mOgAcNIpkzB",
    "requestCount": 30591,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 1,
    "batchId": "batch_673d30d7885481909c89f34bb04fc6ff",
    "fileId": "file-ostJ3WInOKdbsvdB1hw9lkLj",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 2,
    "batchId": "batch_673d30dd92248190a77a5f5e673a19aa",
    "fileId": "file-I7Pm6HmX1E6ujs1S93qvqLAR",
    "requestCount": 30591,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_2.jsonl",
    "model": "text-embedding-3-large",
  },
];

// Configuration
interface DownloadConfig {
  dimensions?: number[];
  batchNumbers?: number[];
  outputDir: string;
  downloadErrors?: boolean;
}

const DOWNLOAD_CONFIG: DownloadConfig = {
  outputDir: join(__dirname, "../words/output/openai/embeddings"),
  downloadErrors: true,
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

interface BatchStatus {
  dimension: number;
  batchNumber: number;
  batchId: string;
  model: string;
  status:
    | "validating"
    | "failed"
    | "in_progress"
    | "finalizing"
    | "completed"
    | "expired"
    | "cancelling"
    | "cancelled";
  request_counts?: {
    completed: number;
    failed: number;
    total: number;
  };
  error_file_id?: string;
  output_file_id?: string;
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

async function downloadFile(fileId: string, outputPath: string): Promise<void> {
  try {
    const response = await openai.files.content(fileId);

    // Create write stream
    const fileStream = createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      // Get response as a blob and pipe it to the file
      // @ts-expect-error
      response.body.pipe(fileStream);

      // Handle errors
      // @ts-expect-error
      response.body.on("error", (err) => {
        reject(err);
      });

      // Resolve when writing is finished
      fileStream.on("finish", () => {
        console.log(`Successfully downloaded: ${outputPath}`);
        resolve();
      });

      fileStream.on("error", (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Error downloading file ${fileId}:`, error);
    throw error;
  }
}

async function getBatchStatus(
  batchInfo: typeof BATCH_INFO[0],
): Promise<BatchStatus> {
  const batch = await openai.batches.retrieve(batchInfo.batchId);

  return {
    dimension: batchInfo.dimension,
    batchNumber: batchInfo.batchNumber,
    batchId: batchInfo.batchId,
    status: batch.status,
    request_counts: batch.request_counts,
    error_file_id: batch.error_file_id,
    output_file_id: batch.output_file_id,
    model: batchInfo.model,
  };
}

async function main() {
  try {
    // Ensure output directory exists
    await ensureDirectoryExists(DOWNLOAD_CONFIG.outputDir);

    // Filter batches based on configuration
    let batchesToDownload = BATCH_INFO;

    console.log(`\nChecking status for ${batchesToDownload.length} batches...`);
    console.log("Configuration:", DOWNLOAD_CONFIG);

    // Get status for all batches
    const statuses = await Promise.all(batchesToDownload.map(getBatchStatus));

    // Filter for completed batches
    const completedBatches = statuses.filter((s) =>
      s.status === "completed" && s.output_file_id
    );

    console.log(
      `\nFound ${completedBatches.length} completed batches to download`,
    );

    // Download each batch
    for (const batch of completedBatches) {
      console.log(
        `\nProcessing ${batch.dimension}d batch ${batch.batchNumber}:`,
      );

      // Download output file
      if (batch.output_file_id) {
        const outputPath = join(
          DOWNLOAD_CONFIG.outputDir,
          `embeddings_${batch.model}_${batch.dimension}d_${batch.batchNumber}.jsonl`,
        );
        console.log(`Downloading embeddings to: ${outputPath}`);
        await downloadFile(batch.output_file_id, outputPath);
      }

      // Download error file if it exists and is configured
      if (DOWNLOAD_CONFIG.downloadErrors && batch.error_file_id) {
        const errorPath = join(
          DOWNLOAD_CONFIG.outputDir,
          `errors_${batch.dimension}d_${batch.batchNumber}.jsonl`,
        );
        console.log(`Downloading errors to: ${errorPath}`);
        await downloadFile(batch.error_file_id, errorPath);
      }

      // Log completion statistics
      console.log("Batch statistics:", {
        completed: batch.request_counts?.completed || 0,
        failed: batch.request_counts?.failed || 0,
        total: batch.request_counts?.total || 0,
      });
    }

    console.log("\nDownload complete!");

    // Log any non-completed batches
    const incompleteBatches = statuses.filter((s) => s.status !== "completed");
    if (incompleteBatches.length > 0) {
      console.log("\nBatches not yet ready for download:");
      console.table(
        incompleteBatches.map((b) => ({
          dimension: `${b.dimension}d`,
          batch: b.batchNumber,
          status: b.status,
        })),
      );
    }
  } catch (error) {
    console.error("Error downloading batch results:", error);
    process.exit(1);
  }
}

main();
