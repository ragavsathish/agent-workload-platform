import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { validateReviewedManifest } from "./journal-reviewed-eval-lib.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (["--input", "--output"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
      index += 1;
    } else if (["--help", "-h"].includes(arg)) options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node journal-annotation-finalize.mjs --input REVIEW_QUEUE.json --output REVIEWED_MANIFEST.json",
    "",
    "Validates completed human review and removes model suggestions before publishing an eval manifest.",
    "The command refuses to overwrite an existing manifest.",
  ].join("\n");
}

function finalManifest(queue) {
  if (!queue || typeof queue !== "object" || Array.isArray(queue)) {
    throw new Error("review queue must be an object");
  }
  if (!Array.isArray(queue.cases)) throw new Error("review queue cases must be an array");
  const manifest = validateReviewedManifest({
    formatVersion: queue.formatVersion,
    datasetId: queue.datasetId,
    privacyReview: queue.privacyReview,
    cases: queue.cases.map(({ predictedEntries: _suggestions, ...item }) => item),
  });
  for (const [index, item] of manifest.cases.entries()) {
    if (item?.errorSlice === "unassigned") {
      throw new Error(`cases[${index}].errorSlice must be assigned during review`);
    }
  }
  return manifest;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.input || !options.output) throw new Error(usage());
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const manifest = finalManifest(JSON.parse(await readFile(inputPath, "utf8")));
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  const splits = Object.fromEntries([...new Set(manifest.cases.map((item) => item.split))]
    .sort()
    .map((split) => [split, manifest.cases.filter((item) => item.split === split).length]));
  console.log(JSON.stringify({
    output: outputPath,
    datasetId: manifest.datasetId,
    reviewedCases: manifest.cases.length,
    splits,
    status: "ready-for-evaluation",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
