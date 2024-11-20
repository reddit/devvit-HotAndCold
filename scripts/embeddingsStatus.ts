import dotenv from "dotenv";
dotenv.config();

import OpenAI from "openai";

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
