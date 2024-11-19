import { dirname, join } from "path";
import { exportToCsv } from "./helpers/wordnet";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration paths
const CONFIG = {
  inputPath: join(__dirname, "../words/input/wordnet"),
  outputPath: join(__dirname, "../words/output"),
  outputFileName: "wordnet.csv",
};

exportToCsv(CONFIG.inputPath, CONFIG.outputPath, CONFIG.outputFileName);
