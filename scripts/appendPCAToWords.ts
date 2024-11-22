import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
import { EVD, Matrix } from "ml-matrix";

interface WordBatch {
  id: number;
  word: string;
  [key: string]: any;
}

interface Config {
  inputEmbeddingsColumn: string;
  outputColumnName: string;
}

const CONFIG: Config = {
  inputEmbeddingsColumn: "embedding_500",
  outputColumnName: "pca_from_500",
};

const client = new pg.Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
});

await client.connect();

async function loadSamplesInBatches(
  config: Config,
  totalSamples: number,
  batchSize = 5000,
) {
  const samples: WordBatch[] = [];
  let offset = 0;

  while (offset < totalSamples) {
    console.log(`Loading sample batch ${offset} to ${offset + batchSize}`);
    const { rows } = await client.query<WordBatch>(
      `
      SELECT 
        id, 
        word,
        ${config.inputEmbeddingsColumn}
      FROM words 
      ORDER BY RANDOM()
      LIMIT $1 
      OFFSET $2
    `,
      [batchSize, offset],
    );

    if (rows.length === 0) {
      console.log("No more rows to load");
      break;
    }
    console.log(`Loaded ${rows.length} rows`);
    samples.push(...rows);
    offset += batchSize;
  }

  console.log(`Total samples loaded: ${samples.length}`);
  return samples;
}

async function processPCAInBatches(config: Config) {
  try {
    console.log("Starting PCA processing...");

    console.log("Loading samples in batches...");
    const sampleRows = await loadSamplesInBatches(config, 100_000);
    console.log(
      `Loaded ${sampleRows.length} total samples for PCA computation`,
    );

    console.log("Converting to matrix format...");
    const X = new Matrix(
      sampleRows.map((row) => JSON.parse(row[config.inputEmbeddingsColumn])),
    );
    console.log(`Matrix dimensions: ${X.rows}x${X.columns}`);

    // Calculate and subtract mean for each feature
    console.log("Computing mean and centering data...");
    const means = Array(X.columns).fill(0);
    for (let j = 0; j < X.columns; j++) {
      for (let i = 0; i < X.rows; i++) {
        means[j] += X.get(i, j);
      }
      means[j] /= X.rows;
    }

    // Compute standard deviations
    const std_devs = Array(X.columns).fill(0);
    for (let j = 0; j < X.columns; j++) {
      for (let i = 0; i < X.rows; i++) {
        std_devs[j] += Math.pow(X.get(i, j) - means[j], 2);
      }
      std_devs[j] = Math.sqrt(std_devs[j] / (X.rows - 1));
    }
    console.log("Mean and std dev computed");

    // Center and standardize the data
    const centeredData = new Matrix(X.rows, X.columns);
    for (let i = 0; i < X.rows; i++) {
      for (let j = 0; j < X.columns; j++) {
        centeredData.set(i, j, (X.get(i, j) - means[j]) / std_devs[j]);
      }
    }
    console.log("Data centered and standardized");

    // Compute covariance matrix
    console.log("Computing covariance matrix...");
    const covMatrix = centeredData.transpose().mmul(centeredData);
    covMatrix.div(X.rows - 1);
    console.log(
      `Covariance matrix dimensions: ${covMatrix.rows}x${covMatrix.columns}`,
    );

    // Compute eigendecomposition
    console.log("Computing eigenvectors...");
    const evd = new EVD(covMatrix);
    const eigenvalues = evd.realEigenvalues;
    const eigenvectors = evd.eigenvectorMatrix;

    // Log eigenvalues for debugging
    console.log("Top 5 eigenvalues:", eigenvalues.slice(0, 5));

    // Sort eigenvectors by eigenvalues in descending order
    const pairs = eigenvalues.map((value, index) => ({ value, index }));
    pairs.sort((a, b) => b.value - a.value);

    // Log variance explained
    const totalVariance = eigenvalues.reduce((a, b) => a + b, 0);
    console.log("Variance explained by top 3 components:");
    for (let i = 0; i < 3; i++) {
      const varianceExplained = (pairs[i].value / totalVariance) * 100;
      console.log(`Component ${i + 1}: ${varianceExplained.toFixed(2)}%`);
    }

    // Select top 3 eigenvectors
    const principalComponents = new Matrix(3, X.columns);
    for (let i = 0; i < 3; i++) {
      const idx = pairs[i].index;
      for (let j = 0; j < X.columns; j++) {
        principalComponents.set(i, j, eigenvectors.get(j, idx));
      }
    }

    // Normalize the principal components
    for (let i = 0; i < 3; i++) {
      const norm = Math.sqrt(
        Array.from({ length: X.columns })
          .map((_, j) => Math.pow(principalComponents.get(i, j), 2))
          .reduce((a, b) => a + b, 0),
      );
      for (let j = 0; j < X.columns; j++) {
        principalComponents.set(i, j, principalComponents.get(i, j) / norm);
      }
    }

    let processed = 0;
    const batchSize = 1000;

    // Process ALL rows, not just NULL ones
    while (true) {
      console.log(`Processing batch starting at offset ${processed}`);

      const { rows: batch } = await client.query<WordBatch>(
        `
        SELECT 
          id, 
          word,
          ${config.inputEmbeddingsColumn}
        FROM words 
        ORDER BY id
        LIMIT $1
        OFFSET $2;
      `,
        [batchSize, processed],
      );

      if (batch.length === 0) {
        console.log("No more batches to process");
        break;
      }

      console.log(`Processing batch of ${batch.length} words`);

      for (const row of batch) {
        const embedding = JSON.parse(row[config.inputEmbeddingsColumn]);
        const centered = embedding.map((val: number, i: number) =>
          (val - means[i]) / std_devs[i]
        );

        const projected = [
          centered.reduce(
            (sum: number, val: number, i: number) =>
              sum + val * principalComponents.get(0, i),
            0,
          ),
          centered.reduce(
            (sum: number, val: number, i: number) =>
              sum + val * principalComponents.get(1, i),
            0,
          ),
          centered.reduce(
            (sum: number, val: number, i: number) =>
              sum + val * principalComponents.get(2, i),
            0,
          ),
        ];

        // Normalize the projected vector
        const norm = Math.sqrt(
          projected.reduce((sum, val) => sum + val * val, 0),
        );
        const normalizedProjected = projected.map((val) => val / norm);

        await client.query(
          `
          UPDATE words 
          SET ${config.outputColumnName} = $1::vector(3)
          WHERE id = $2
        `,
          [JSON.stringify(normalizedProjected), row.id],
        );
      }

      processed += batch.length;
      console.log(`Processed ${processed} rows`);
    }

    console.log("Creating index...");
    await client.query(`
      DROP INDEX IF EXISTS ${config.outputColumnName}_idx;
      CREATE INDEX ${config.outputColumnName}_idx 
      ON words USING hnsw (${config.outputColumnName} vector_cosine_ops) 
      WITH (m = 16, ef_construction = 64);
    `);

    console.log("PCA processing complete!");
    return;
  } catch (error) {
    console.error("Error processing PCA:", error);
    throw error;
  } finally {
    await client.end();
  }
}

processPCAInBatches(CONFIG).catch(console.error);
