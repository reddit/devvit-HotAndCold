import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";

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

// Configuration for which batches to check
interface CheckConfig {
  dimensions?: number[]; // Only check specific dimensions
  batchNumbers?: number[]; // Only check specific batch numbers
  failedOnly?: boolean; // Only show failed or incomplete batches
}

const CHECK_CONFIG: CheckConfig = {
  failedOnly: false, // Show all statuses
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

interface BatchStatus {
  dimension: number;
  batchNumber: number;
  batchId: string;
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
  errors: any;
  error_file_id?: string;
  output_file_id?: string;
}

async function checkBatchStatus(
  batchInfo: typeof BATCH_INFO[0],
): Promise<BatchStatus> {
  const batch = await openai.batches.retrieve(batchInfo.batchId);

  console.log(JSON.stringify(batch, null, 2));

  return {
    dimension: batchInfo.dimension,
    batchNumber: batchInfo.batchNumber,
    batchId: batchInfo.batchId,
    status: batch.status,
    request_counts: batch.request_counts,
    errors: batch.errors,
    error_file_id: batch.error_file_id,
    output_file_id: batch.output_file_id,
  };
}

async function main() {
  try {
    // Filter batches based on configuration
    let batchesToCheck = BATCH_INFO;

    console.log(`\nChecking status for ${batchesToCheck.length} batches...`);
    console.log("Configuration:", CHECK_CONFIG);

    // Check all filtered batches
    const statuses = await Promise.all(
      batchesToCheck.map(checkBatchStatus),
    );

    // Filter for failed only if configured
    const displayStatuses = CHECK_CONFIG.failedOnly
      ? statuses.filter((s) =>
        s.status !== "completed" ||
        (s.request_counts?.failed && s.request_counts.failed > 0)
      )
      : statuses;

    // Display results
    console.log("\n=== BATCH STATUS SUMMARY ===");
    console.table(displayStatuses.map((status) => ({
      dimension: `${status.dimension}d`,
      batch: status.batchNumber,
      status: status.status,
      progress: status.request_counts
        ? `${
          ((status.request_counts.completed + status.request_counts.failed) /
            status.request_counts.total * 100).toFixed(1)
        }%`
        : "N/A",
      completed: status.request_counts?.completed || 0,
      failed: status.request_counts?.failed || 0,
      total: status.request_counts?.total || 0,
      output_file: status.output_file_id || "None",
      error_file: status.error_file_id || "None",
    })));

    // Display any failed batches separately
    const failedBatches = displayStatuses.filter((s) =>
      s.request_counts?.failed && s.request_counts.failed > 0
    );
    if (failedBatches.length > 0) {
      console.log("\n=== FAILED BATCHES ===");
      console.table(failedBatches.map((status) => ({
        dimension: `${status.dimension}d`,
        batch: status.batchNumber,
        batchId: status.batchId,
        failed: status.request_counts?.failed || 0,
        errors: JSON.stringify(status.errors),
        error_file: status.error_file_id || "None",
      })));
    }
  } catch (error) {
    console.error("Error checking batch status:", error);
    process.exit(1);
  }
}

main();
