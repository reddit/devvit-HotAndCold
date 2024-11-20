import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";

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
  error_file_id?: string;
  output_file_id?: string;
}

async function checkBatchStatus(
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
        error_file: status.error_file_id || "None",
      })));
    }
  } catch (error) {
    console.error("Error checking batch status:", error);
    process.exit(1);
  }
}

main();
