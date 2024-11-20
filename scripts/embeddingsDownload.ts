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
    "batchId": "batch_673e559c07888190911774daf17f326f",
    "fileId": "file-21aedNXioVE27TauRqYePy8j",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 50,
    "batchNumber": 2,
    "batchId": "batch_673e55a0da7881908d067c882de5b478",
    "fileId": "file-UFWGjkcKlj18RHHsePyyFxyX",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 1,
    "batchId": "batch_673e55a4dc68819085da30ed3f31a76e",
    "fileId": "file-ppFRt7QobpGwNxGQrBLXxF13",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 2,
    "batchId": "batch_673e55a9bde0819099880653eef1e4bf",
    "fileId": "file-szYLSZ5i0LfXghl2WaVMqCPh",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 200,
    "batchNumber": 1,
    "batchId": "batch_673e55ae2e988190bc90bc4901f90453",
    "fileId": "file-1kXV40fMjO23V8TcpJ60GtwE",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_200d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 200,
    "batchNumber": 2,
    "batchId": "batch_673e55b2434481909fa0144d13dd800c",
    "fileId": "file-Im2a1a8txzKxayo7EK13Rk9T",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_200d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 300,
    "batchNumber": 1,
    "batchId": "batch_673e55b7560481908a7b9d5798ad9850",
    "fileId": "file-ThYqUU6pdD0QmbillUzXVA4K",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_300d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 300,
    "batchNumber": 2,
    "batchId": "batch_673e55bb90348190a035062f964dc13c",
    "fileId": "file-dVbCdALZB6mW69PeFMytVvb3",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_300d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 500,
    "batchNumber": 1,
    "batchId": "batch_673e55c04124819081fc9f8ac518c3d0",
    "fileId": "file-OlVY39YrnIJdhjDjw6Qz1OB1",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_500d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 500,
    "batchNumber": 2,
    "batchId": "batch_673e55c4464c819090428a7008cc67c0",
    "fileId": "file-6Muh6RSNfWsLpCYGwWTcZQep",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_500d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 1,
    "batchId": "batch_673e55c980e081908529a7fac7dbcbf8",
    "fileId": "file-hJfipvQs9PLjGsv962nxh5Tg",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 2,
    "batchId": "batch_673e55cd66b88190b00c14da8cc60b9b",
    "fileId": "file-ydF98BesTeyTKIoxa2MX6DH6",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 3072,
    "batchNumber": 1,
    "batchId": "batch_673e55d136948190b52d06828cbcfef0",
    "fileId": "file-MH2UqAwYEK6MOjx7uNHOmgxz",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_3072d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 3072,
    "batchNumber": 2,
    "batchId": "batch_673e55d527b88190a7ea8115df9f26c1",
    "fileId": "file-bLAGRsnoL0yy5R7CZBTqLrhJ",
    "requestCount": 32427,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_3072d_2.jsonl",
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
