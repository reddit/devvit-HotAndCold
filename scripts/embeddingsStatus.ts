import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

async function checkBatches() {
  try {
    console.log("Fetching all batches...\n");

    const batchList = await openai.batches.list();
    const batches = [];

    // Collect all batches
    for await (const batch of batchList) {
      batches.push(batch);
    }

    // Group batches by status
    const statusGroups: Record<string, typeof batches> = {};
    batches.forEach((batch) => {
      if (!statusGroups[batch.status]) {
        statusGroups[batch.status] = [];
      }
      statusGroups[batch.status].push(batch);
    });

    // Print summary
    console.log("=== BATCH STATUS SUMMARY ===");
    console.log(`Total batches: ${batches.length}\n`);

    // Print status groups
    for (const [status, batchGroup] of Object.entries(statusGroups)) {
      console.log(`${status.toUpperCase()} (${batchGroup.length})`);

      for (const batch of batchGroup) {
        const created = new Date(batch.created_at * 1000).toLocaleString();
        const completed = batch.completed_at
          ? new Date(batch.completed_at * 1000).toLocaleString()
          : "N/A";

        console.log(`  Batch ID: ${batch.id}`);
        console.log(`  - Created: ${created}`);
        console.log(`  - Completed: ${completed}`);
        console.log(`  - Status: ${batch.status}`);
        console.log(
          `  - Requests: ${batch.request_counts?.completed}/${batch.request_counts?.total} completed`,
        );

        if (batch.errors) {
          console.log("Found errors:", JSON.stringify(batch.errors, null, 2));
        }

        // Show output file if completed
        if (batch.output_file_id) {
          console.log(`  - Output file: ${batch.output_file_id}`);
        }

        console.log(""); // Empty line between batches
      }
      console.log(""); // Empty line between status groups
    }

    // Print instructions for completed batches
    const completedBatches = statusGroups["completed"] || [];
    if (completedBatches.length > 0) {
      console.log("=== DOWNLOAD INSTRUCTIONS ===");
      console.log("To download results for completed batches, use:");
      console.log(
        'const fileResponse = await openai.files.content("file-id");',
      );
      console.log("const fileContents = await fileResponse.text();\n");
    }
  } catch (error) {
    console.error("Error checking batches:", error);
    process.exit(1);
  }
}

// Run the check
checkBatches();
