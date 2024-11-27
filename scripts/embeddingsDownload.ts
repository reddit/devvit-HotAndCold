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
    "batchId": "batch_674750a283088190b5c30c44ef7c5ab2",
    "fileId": "file-JdmVMdMoMHyutJMgs34XV8",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 50,
    "batchNumber": 2,
    "batchId": "batch_674750a6089881909e236e4ae93e6254",
    "fileId": "file-Vd8LuiuHGYweT6tUuPJt3K",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_50d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 1,
    "batchId": "batch_674750a959888190a165a72d2c638ae4",
    "fileId": "file-ATXWgd4HJNSMpSA3jCLZLZ",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 100,
    "batchNumber": 2,
    "batchId": "batch_674750acd4e08190aef9a950abdd9b34",
    "fileId": "file-QzFm3gD33uwmmwXqeUqVrm",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_100d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 200,
    "batchNumber": 1,
    "batchId": "batch_674750af397c8190a78e7cab60e07806",
    "fileId": "file-AvLAxXCLnbt8WGgGJ6RDJK",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_200d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 200,
    "batchNumber": 2,
    "batchId": "batch_674750b2211c819098bb80ee8a0f568b",
    "fileId": "file-RwqfyyPkAyciTV3F2yfTeF",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_200d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 300,
    "batchNumber": 1,
    "batchId": "batch_674750b76c948190b07b7d2f9c550a95",
    "fileId": "file-UycVnH3t6qSwj26dV2eu6d",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_300d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 300,
    "batchNumber": 2,
    "batchId": "batch_674750bc7e8c8190a1d0af02af2b3c14",
    "fileId": "file-NweZ6M9UG4BkWjNSExRpbt",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_300d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 500,
    "batchNumber": 1,
    "batchId": "batch_674750bf9ecc8190addd99861deb141b",
    "fileId": "file-PfEoTn8a9n6oSwBggVyi81",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_500d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 500,
    "batchNumber": 2,
    "batchId": "batch_674750c28ab88190a659ea6bc9e77096",
    "fileId": "file-2kviB4dUkuYHjWqsa8SPAX",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_500d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 1,
    "batchId": "batch_674750c57da48190bfec0b14ee3d2a94",
    "fileId": "file-3YMeXFJ7PsgFAU6fn8BpiD",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 1536,
    "batchNumber": 2,
    "batchId": "batch_674750c8c164819091ec0457b8925e9b",
    "fileId": "file-StetSBDWUsmqHpejDTAyYa",
    "requestCount": 27291,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_1536d_2.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 3072,
    "batchNumber": 1,
    "batchId": "batch_674750cb70d08190893e3071e96823ac",
    "fileId": "file-4M8JFWRaM1wwpj1mDo69gc",
    "requestCount": 45000,
    "filePath":
      "/Users/marcus.wood/community-apps/hotandcold/words/output/openai/batches/batch_text-embedding-3-large_3072d_1.jsonl",
    "model": "text-embedding-3-large",
  },
  {
    "dimension": 3072,
    "batchNumber": 2,
    "batchId": "batch_674750ce91fc8190884d38a3e6d3c6d4",
    "fileId": "file-DcSLgKuM5R9ZbtospqfoKa",
    "requestCount": 27291,
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
