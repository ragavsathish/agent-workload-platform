import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { basename, join, resolve } from "node:path";

import {
  captureCognitiveJournal,
  prepareCognitiveJournalTranscript,
} from "../../dist/digital-twin/runtime/cognitive-journal.js";
import {
  JOURNAL_SPLITS,
  buildReviewedMetrics,
  compareReviewedCase,
  digestJson,
  validateReviewedManifest,
} from "./journal-reviewed-eval-lib.mjs";

function usage() {
  return [
    "Usage: node journal-reviewed-eval.mjs --input MANIFEST.json --output PRIVATE_DIR --split SPLIT [options]",
    "",
    `Splits: ${JOURNAL_SPLITS.join(", ")}`,
    "Options:",
    "  --base-url URL                 Ollama-compatible base URL (default http://127.0.0.1:11434)",
    "  --model NAME                   Model name (default production journal model)",
    "  --allow-locked-holdout         Required to evaluate locked_holdout",
    "  --force                        Replace output files in an existing directory",
  ].join("\n");
}

function parseArgs(argv) {
  const options = { baseUrl: "http://127.0.0.1:11434", force: false, allowLockedHoldout: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--force") options.force = true;
    else if (arg === "--allow-locked-holdout") options.allowLockedHoldout = true;
    else if (["--input", "--output", "--split", "--base-url", "--model"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else if (["--help", "-h"].includes(arg)) options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function parseRawEntries(payload) {
  try {
    const content = payload?.message?.content;
    if (typeof content !== "string") return [];
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

async function observeCase(item, options) {
  const startedAt = performance.now();
  let rawEntries = [];
  try {
    const capture = await captureCognitiveJournal(item.transcript, {
      id: `reviewed-eval-${createHash("sha256").update(item.id).digest("hex").slice(0, 24)}`,
      sourceRef: `journal-reviewed-eval:${item.id}`,
      baseUrl: options.baseUrl,
      model: options.model,
      fetch: async (...args) => {
        const response = await fetch(...args);
        const payload = await response.clone().json().catch(() => undefined);
        rawEntries = parseRawEntries(payload);
        return response;
      },
    });
    return {
      entries: capture.entries,
      rawEntries,
      eligibleTranscript: prepareCognitiveJournalTranscript(item.transcript),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      entries: [],
      rawEntries,
      eligibleTranscript: prepareCognitiveJournalTranscript(item.transcript),
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeOutput(path, content, force) {
  try {
    await writeFile(path, content, { encoding: "utf8", flag: force ? "w" : "wx" });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`refusing to overwrite ${path}; use --force for a deliberate rerun`);
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.input || !options.output || !options.split) throw new Error(usage());
  if (!JOURNAL_SPLITS.includes(options.split)) throw new Error(`unsupported split: ${options.split}`);
  if (options.split === "locked_holdout" && !options.allowLockedHoldout) {
    throw new Error("locked_holdout requires --allow-locked-holdout and should be evaluated once per dataset version");
  }

  const inputPath = resolve(options.input);
  const outputDir = resolve(options.output);
  const manifest = validateReviewedManifest(JSON.parse(await readFile(inputPath, "utf8")));
  const selectedCases = manifest.cases.filter((item) => item.split === options.split);
  if (selectedCases.length === 0) throw new Error(`manifest has no ${options.split} cases`);

  const runtimePath = new URL("../runtime/cognitive-journal.ts", import.meta.url);
  const evaluatorPath = new URL("./journal-reviewed-eval-lib.mjs", import.meta.url);
  const configuration = {
    baseUrl: options.baseUrl,
    model: options.model ?? "qwen3.5:9b-mlx",
    matcher: "deterministic-evidence-or-normalized-levenshtein",
    nearTextThreshold: 0.9,
  };
  const digests = {
    dataset: digestJson(manifest),
    selectedCases: digestJson(selectedCases),
    configuration: digestJson(configuration),
    runtime: await sha256File(runtimePath),
    evaluator: await sha256File(evaluatorPath),
  };

  const results = [];
  for (const item of selectedCases) {
    const observation = await observeCase(item, options);
    results.push(compareReviewedCase(item, observation));
  }
  const metrics = buildReviewedMetrics(
    { ...manifest, cases: selectedCases },
    results,
    { split: options.split, configuration, digests },
  );
  const comparisonRows = results.flatMap((result) => result.rows);
  const failures = comparisonRows.filter((row) => !["exact_match", "near_text_match"].includes(row.status));
  const run = {
    formatVersion: 1,
    input: basename(inputPath),
    split: options.split,
    cases: selectedCases.length,
    configuration,
    digests,
  };

  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeOutput(join(outputDir, "comparison.jsonl"), `${comparisonRows.map((row) => JSON.stringify(row)).join("\n")}\n`, options.force),
    writeOutput(join(outputDir, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`, options.force),
    writeOutput(join(outputDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, options.force),
    writeOutput(join(outputDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, options.force),
  ]);
  console.log(JSON.stringify({ outputDir, metrics }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
