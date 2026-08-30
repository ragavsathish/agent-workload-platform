#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [goldenPath, candidatePath] = process.argv.slice(2);
if (!goldenPath || !candidatePath) {
  console.error("usage: evaluate-golden.mjs GOLDEN.json CANDIDATE.json");
  process.exit(2);
}

const [golden, candidate] = await Promise.all(
  [goldenPath, candidatePath].map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);

const counts = (elements) =>
  Object.fromEntries(
    [...new Set(elements.map(({ type }) => type))]
      .sort()
      .map((type) => [type, elements.filter((element) => element.type === type).length]),
  );
const texts = (elements) =>
  new Set(elements.filter(({ type }) => type === "text").map(({ text }) => text));

const goldenTexts = texts(golden.elements);
const candidateTexts = texts(candidate.elements);
const missingTexts = [...goldenTexts].filter((text) => !candidateTexts.has(text));
const extraTexts = [...candidateTexts].filter((text) => !goldenTexts.has(text));
const goldenCounts = counts(golden.elements);
const candidateCounts = counts(candidate.elements);
const warnings = candidate.warning ? [candidate.warning] : [];
const passed =
  missingTexts.length === 0 &&
  extraTexts.length === 0 &&
  JSON.stringify(goldenCounts) === JSON.stringify(candidateCounts) &&
  warnings.length === 0;

console.log(
  JSON.stringify(
    {
      passed,
      semanticText: {
        expected: goldenTexts.size,
        actual: candidateTexts.size,
        missing: missingTexts,
        extra: extraTexts,
      },
      elementTypes: { expected: goldenCounts, actual: candidateCounts },
      wassetteWarnings: warnings,
      note: "Element IDs, checkpoint IDs, coordinates, and loopback URLs are intentionally not compared.",
    },
    null,
    2,
  ),
);

process.exitCode = passed ? 0 : 1;
