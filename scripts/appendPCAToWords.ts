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

async function loadSamplesInBatches(
  client: pg.Client,
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

    if (rows.length === 0) break;
    samples.push(...rows);
    offset += batchSize;
  }

  return samples;
}

async function processPCAInBatches(config: Config) {
  const client = new pg.Client({
    connectionString: process.env.PG_CONNECTION_STRING,
  });

  await client.connect();

  try {
    await client.query(`
      ALTER TABLE words 
      ADD COLUMN IF NOT EXISTS ${config.outputColumnName} vector(3);
    `);

    console.log("Loading samples in batches...");
    const sampleRows = await loadSamplesInBatches(client, config, 100_000);

    console.log("Converting to matrix format...");
    const X = new Matrix(
      sampleRows.map((row) => JSON.parse(row[config.inputEmbeddingsColumn])),
    );

    console.log("Computing mean and centering data...");
    const means = Array(X.columns).fill(0);
    for (let j = 0; j < X.columns; j++) {
      for (let i = 0; i < X.rows; i++) {
        means[j] += X.get(i, j);
      }
      means[j] /= X.rows;
    }

    const centeredData = new Matrix(X.rows, X.columns);
    for (let i = 0; i < X.rows; i++) {
      for (let j = 0; j < X.columns; j++) {
        centeredData.set(i, j, X.get(i, j) - means[j]);
      }
    }

    console.log("Computing covariance matrix...");
    const covMatrix = centeredData.transpose().mmul(centeredData);
    covMatrix.div(X.rows - 1);

    console.log("Computing eigenvectors...");
    const evd = new EVD(covMatrix);

    const principalComponents = new Matrix(3, X.columns);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < X.columns; j++) {
        principalComponents.set(i, j, evd.eigenvectorMatrix.get(j, i));
      }
    }

    let processed = 0;
    const batchSize = 1000;

    while (true) {
      console.log(`Processing batch starting at offset ${processed}`);

      const { rows: batch } = await client.query<WordBatch>(
        `
        SELECT 
          id, 
          word,
          ${config.inputEmbeddingsColumn}
        FROM words 
        WHERE ${config.outputColumnName} IS NULL
        ORDER BY id
        LIMIT $1;
      `,
        [batchSize],
      );

      if (batch.length === 0) break;

      for (const row of batch) {
        const embedding = JSON.parse(row[config.inputEmbeddingsColumn]);
        const centered = embedding.map((val: number, i: number) =>
          val - means[i]
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

        await client.query(
          `
          UPDATE words 
          SET ${config.outputColumnName} = $1::vector(3)
          WHERE id = $2
        `,
          [JSON.stringify(projected), row.id],
        );
      }

      processed += batch.length;
      console.log(`Processed ${processed} rows`);
    }

    console.log("Creating index...");
    await client.query(`
      CREATE INDEX IF NOT EXISTS ${config.outputColumnName}_idx 
      ON words USING hnsw (${config.outputColumnName} vector_cosine_ops) 
      WITH (m = 16, ef_construction = 64);
    `);

    return;

    console.log("Creating similarity function...");
    await client.query(`
      CREATE OR REPLACE FUNCTION find_similar_words_${config.outputColumnName}(
        target_word VARCHAR,
        max_results INTEGER DEFAULT 1000,
        ef_search INTEGER DEFAULT 100
      )
      RETURNS TABLE (
        word VARCHAR,
        similarity FLOAT,
        definition TEXT,
        part_of_speech part_of_speech_enum,
        synset_type VARCHAR,
        is_hint BOOLEAN
      )
      LANGUAGE plpgsql
      AS $$
      BEGIN
        SET LOCAL hnsw.ef_search = ef_search;
        
        RETURN QUERY
        WITH target AS (
          SELECT ${config.outputColumnName}, word as target_word
          FROM words
          WHERE word = target_word
        )
        SELECT 
          w.word,
          1 - (w.${config.outputColumnName} <=> (SELECT ${config.outputColumnName} FROM target)) as similarity,
          w.definition,
          w.part_of_speech,
          w.synset_type,
          w.is_hint
        FROM words w
        WHERE w.word != (SELECT target_word FROM target)
        ORDER BY w.${config.outputColumnName} <=> (SELECT ${config.outputColumnName} FROM target)
        LIMIT max_results;
      END;
      $$;
    `);

    console.log("Validating results...");
    const { rows: validation } = await client.query(`
      WITH sample AS (
        SELECT 
          word,
          ${config.outputColumnName},
          ${config.inputEmbeddingsColumn}
        FROM words
        WHERE ${config.outputColumnName} IS NOT NULL
        LIMIT 5
      )
      SELECT 
        w1.word as word1,
        w2.word as word2,
        1 - (w1.${config.outputColumnName} <=> w2.${config.outputColumnName}) as pca_similarity,
        1 - (w1.${config.inputEmbeddingsColumn} <=> w2.${config.inputEmbeddingsColumn}) as original_similarity
      FROM sample w1
      CROSS JOIN sample w2
      WHERE w1.word < w2.word;
    `);

    console.log("\nValidation Results:");
    console.log("Word Pair | PCA Sim | Original Sim | Diff");
    console.log("-".repeat(50));
    validation.forEach((row) => {
      const diff = Math.abs(row.pca_similarity - row.original_similarity);
      console.log(
        `${row.word1.padEnd(8)} - ${row.word2.padEnd(8)} | ` +
          `${row.pca_similarity.toFixed(3).padStart(7)} | ` +
          `${row.original_similarity.toFixed(3).padStart(11)} | ` +
          `${diff.toFixed(3).padStart(6)}`,
      );
    });

    console.log("\nProcessing complete!");
  } catch (error) {
    console.error("Error processing PCA:", error);
    throw error;
  } finally {
    await client.end();
  }
}

processPCAInBatches(CONFIG).catch(console.error);
