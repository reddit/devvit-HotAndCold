import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DOWNLOAD_CONFIG = {
  outputDir: join(__dirname, "../words/output/openai/errors"),
};

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

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Type definitions
interface BatchInfo {
  dimension: number;
  batchNumber: number;
  batchId: string;
  fileId: string;
  requestCount: number;
  filePath: string;
  model: string;
}

interface BatchErrorResult {
  batchId: string;
  dimension: number;
  batchNumber: number;
  status: "downloaded" | "no_errors" | "failed";
  errorCount?: number;
  path?: string | null;
  error?: string;
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

async function downloadErrorFile(
  fileId: string,
  outputPath: string,
): Promise<void> {
  try {
    const response = await openai.files.content(fileId);
    const fileStream = createWriteStream(outputPath);

    return new Promise((resolve, reject) => {
      if (!response.body) {
        reject(new Error("No response body received"));
        return;
      }

      // @ts-expect-error
      response.body.pipe(fileStream);

      // @ts-expect-error
      response.body.on("error", (err) => {
        reject(err);
      });

      fileStream.on("finish", () => {
        console.log(`Successfully downloaded error file: ${outputPath}`);
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

async function getBatchErrors(batchInfo: BatchInfo): Promise<BatchErrorResult> {
  try {
    const batch = await openai.batches.retrieve(batchInfo.batchId);
    const outputPath = join(
      DOWNLOAD_CONFIG.outputDir,
      `errors_${batchInfo.model}_${batchInfo.dimension}d_${batchInfo.batchNumber}.jsonl`,
    );

    if (batch.error_file_id) {
      console.log(
        `\nFound error file for ${batchInfo.dimension}d batch ${batchInfo.batchNumber}`,
      );
      console.log(`Status: ${batch.status}`);
      console.log(`Error count: ${batch.request_counts?.failed || 0}`);

      await ensureDirectoryExists(dirname(outputPath));
      await downloadErrorFile(batch.error_file_id, outputPath);

      return {
        batchId: batchInfo.batchId,
        dimension: batchInfo.dimension,
        batchNumber: batchInfo.batchNumber,
        status: "downloaded",
        errorCount: batch.request_counts?.failed || 0,
        path: outputPath,
      };
    }

    return {
      batchId: batchInfo.batchId,
      dimension: batchInfo.dimension,
      batchNumber: batchInfo.batchNumber,
      status: "no_errors",
      errorCount: 0,
      path: null,
    };
  } catch (error) {
    console.error(`Error processing batch ${batchInfo.batchId}:`, error);
    return {
      batchId: batchInfo.batchId,
      dimension: batchInfo.dimension,
      batchNumber: batchInfo.batchNumber,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
      path: null,
    };
  }
}

async function main() {
  try {
    console.log("Starting error file download process...");
    console.log(`Processing ${BATCH_INFO.length} batches...`);

    const results = await Promise.all(
      BATCH_INFO.map(getBatchErrors),
    );

    console.log("\nDownload Summary:");
    console.table(results.map((r) => ({
      dimension: `${r.dimension}d`,
      batch: r.batchNumber,
      status: r.status,
      errors: r.errorCount || "N/A",
      path: r.path || "N/A",
    })));

    const totalErrors = results.reduce(
      (sum, r) => sum + (r.errorCount || 0),
      0,
    );

    console.log(`\nTotal errors found: ${totalErrors}`);
    console.log("Process complete!");
  } catch (error) {
    console.error("Error in main process:", error);
    process.exit(1);
  }
}

main();
