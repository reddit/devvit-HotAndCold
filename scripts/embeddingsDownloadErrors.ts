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
