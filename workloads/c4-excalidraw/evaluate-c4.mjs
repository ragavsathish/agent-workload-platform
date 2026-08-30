#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [sourcePath, statePath] = process.argv.slice(2);
if (!sourcePath || !statePath) {
  console.error("usage: evaluate-c4.mjs SOURCE.mmd EXCALIDRAW_STATE.json");
  process.exit(2);
}

const [source, state] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(statePath, "utf8").then(JSON.parse),
]);
const lines = source.split(/\r?\n/).map((line) => line.trim());
const declarations = lines.filter((line) =>
  /^(?:Person(?:_Ext)?|System(?:_Ext)?|Container(?:Db|Queue)?|Component|Deployment_Node|Node(?:_[LR])?|(?:System|Container|Enterprise)_Boundary|Rel(?:_[RLUD])?)\s*\(/.test(
    line,
  ),
);
const quotedValues = declarations.flatMap((line) =>
  [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]),
);
const title = lines.find((line) => /^title\s+/.test(line))?.replace(/^title\s+/, "");
const expectedText = [...new Set([title, ...quotedValues].filter(Boolean))];
const nodeDeclarations = declarations.filter((line) => !/^Rel(?:_[RLUD])?\s*\(/.test(line));
const ellipseDeclarations = nodeDeclarations.filter((line) => /^(?:Person(?:_Ext)?|ContainerDb)\s*\(/.test(line));
const expectedCounts = {
  arrow: declarations.filter((line) => /^Rel(?:_[RLUD])?\s*\(/.test(line)).length,
  ellipse: ellipseDeclarations.length,
  rectangle: nodeDeclarations.length - ellipseDeclarations.length,
};
const normalize = (value) =>
  value.replace(/[‐‑‒–—−]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();
const renderedText = normalize(
  state.elements
    .filter(({ type }) => type === "text")
    .map(({ text }) => text)
    .join("\n"),
);
const missingText = expectedText.filter((value) => !renderedText.includes(normalize(value)));
const actualCounts = Object.fromEntries(
  Object.keys(expectedCounts).map((type) => [
    type,
    state.elements.filter((element) => element.type === type).length,
  ]),
);
const countMismatches = Object.fromEntries(
  Object.entries(expectedCounts).filter(([type, count]) => actualCounts[type] !== count),
);
const invalidGeometry = state.elements
  .filter(
    ({ x, y, width, height }) =>
      ![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0,
  )
  .map(({ id }) => id);
const warnings = state.warning ? [state.warning] : [];
const passed =
  missingText.length === 0 &&
  Object.keys(countMismatches).length === 0 &&
  invalidGeometry.length === 0 &&
  warnings.length === 0;

console.log(
  JSON.stringify(
    {
      passed,
      semantics: { expectedTextItems: expectedText.length, missingText },
      structure: { expected: expectedCounts, actual: actualCounts, countMismatches },
      invalidGeometry,
      wassetteWarnings: warnings,
      note: "This intentionally ignores bytes, IDs, exact coordinates, colors, checkpoints, and URLs.",
    },
    null,
    2,
  ),
);
process.exitCode = passed ? 0 : 1;
