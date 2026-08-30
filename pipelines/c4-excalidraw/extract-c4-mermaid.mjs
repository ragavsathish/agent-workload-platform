#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: extract-c4-mermaid.mjs MODEL_OUTPUT OUTPUT.mmd");
  process.exit(2);
}

const raw = await readFile(inputPath, "utf8");
const lines = raw.split(/\r?\n/);
const start = lines.findIndex((line) =>
  /^\s*C4(?:Context|Container|Component|Dynamic|Deployment)\b/.test(line),
);
if (start < 0) {
  console.error("Qwen output did not contain a supported Mermaid C4 diagram");
  process.exit(1);
}

const body = lines
  .slice(start)
  .filter((line) => !/^\s*```/.test(line))
  .join("\n")
  .trimEnd();
await writeFile(outputPath, `${body}\n`);
