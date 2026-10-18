import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const QUERY = `
PREFIX schema: <https://schema.org/>

SELECT ?capture ?transcript ?entry ?predictedType ?predictedText ?topic WHERE {
  GRAPH <urn:awp:digital-twin:graph:journal> {
    ?capture a schema:Message ; schema:text ?transcript .
    OPTIONAL {
      ?entry a schema:CreativeWork ;
        schema:isBasedOn ?capture ;
        schema:additionalType ?predictedType ;
        schema:text ?predictedText .
      OPTIONAL { ?entry schema:keywords ?topic }
    }
  }
}
ORDER BY ?capture ?entry ?topic
`;

function parseArgs(argv) {
  const options = { queryUrl: "http://127.0.0.1:7878/query", limit: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (["--output", "--query-url", "--limit"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--output") options.output = value;
      else if (arg === "--query-url") options.queryUrl = value;
      else options.limit = Number.parseInt(value, 10);
      index += 1;
    } else if (["--help", "-h"].includes(arg)) options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    throw new Error("--limit must be an integer between 1 and 500");
  }
  return options;
}

function usage() {
  return [
    "Usage: node journal-annotation-export.mjs --output PRIVATE.json [options]",
    "",
    "Exports a stratified, pending HITL queue from the private journal graph.",
    "The result is not gold data until a human completes the review fields.",
    "",
    "Options:",
    "  --query-url URL   Oxigraph SPARQL endpoint (default http://127.0.0.1:7878/query)",
    "  --limit N         Maximum captures to export (default 40)",
  ].join("\n");
}

function bindings(payload) {
  const rows = payload?.results?.bindings;
  if (!Array.isArray(rows)) throw new Error("Oxigraph returned invalid SPARQL results");
  return rows.map((binding) => Object.fromEntries(
    Object.entries(binding).flatMap(([key, cell]) => (
      typeof cell?.value === "string" ? [[key, cell.value]] : []
    )),
  ));
}

function groupCaptures(rows) {
  const captures = new Map();
  for (const row of rows) {
    const capture = captures.get(row.capture) ?? {
      capture: row.capture,
      transcript: row.transcript,
      predictedEntries: new Map(),
    };
    if (row.entry) {
      const entry = capture.predictedEntries.get(row.entry) ?? {
        type: row.predictedType,
        text: row.predictedText,
        topics: [],
      };
      if (row.topic && !entry.topics.includes(row.topic)) entry.topics.push(row.topic);
      capture.predictedEntries.set(row.entry, entry);
    }
    captures.set(row.capture, capture);
  }
  return [...captures.values()].map((capture) => ({
    ...capture,
    predictedEntries: [...capture.predictedEntries.values()],
  }));
}

function stableRank(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stratifiedSample(captures, limit) {
  const buckets = new Map();
  for (const capture of captures) {
    const keys = capture.predictedEntries.length === 0
      ? ["empty"]
      : [...new Set(capture.predictedEntries.map((entry) => entry.type))];
    const key = keys.sort()[0];
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(capture);
  }
  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => stableRank(left.capture).localeCompare(stableRank(right.capture)));
  }
  const selected = [];
  const selectedIds = new Set();
  const orderedBuckets = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right));
  while (selected.length < Math.min(limit, captures.length)) {
    let added = false;
    for (const [, bucket] of orderedBuckets) {
      const candidate = bucket.find((capture) => !selectedIds.has(capture.capture));
      if (!candidate) continue;
      selected.push(candidate);
      selectedIds.add(candidate.capture);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
  }
  return selected;
}

function privateCase(capture) {
  const id = `journal-${stableRank(capture.capture).slice(0, 20)}`;
  return {
    id,
    semanticFamilyId: id,
    split: "development",
    sourceKind: "production_journal",
    errorSlice: "unassigned",
    annotationStatus: "pending",
    transcript: capture.transcript,
    predictedEntries: capture.predictedEntries,
    expectedEntries: [],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.output) throw new Error(usage());
  const response = await fetch(options.queryUrl, {
    method: "POST",
    headers: {
      accept: "application/sparql-results+json",
      "content-type": "application/sparql-query",
    },
    body: QUERY,
  });
  if (!response.ok) throw new Error(`Oxigraph query failed: ${response.status} ${response.statusText}`);
  const captures = groupCaptures(bindings(await response.json()));
  const selected = stratifiedSample(captures, options.limit);
  const output = {
    formatVersion: 1,
    datasetId: `journal-review-${new Date().toISOString().slice(0, 10)}`,
    privacyReview: { status: "pending", reviewedAt: null },
    instructions: [
      "Review transcript privacy and redact secrets before setting privacyReview.status to passed.",
      "Treat predictedEntries as suggestions only; do not copy them without owner review.",
      "Set expectedEntries to reviewed durable entries with exact contiguous evidenceQuote values, or [] for an explicit reviewed empty case.",
      "Set annotationStatus to reviewed or adjudicated, assign an errorSlice, and cluster paraphrases under one semanticFamilyId.",
      "Keep semantic families in only one split; reserve locked_holdout for a single promotion evaluation.",
    ],
    population: {
      captures: captures.length,
      capturesWithEntries: captures.filter((capture) => capture.predictedEntries.length > 0).length,
      capturesWithoutEntries: captures.filter((capture) => capture.predictedEntries.length === 0).length,
      selected: selected.length,
    },
    cases: selected.map(privateCase),
  };
  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify({
    output: outputPath,
    population: output.population,
    status: "pending-human-review",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
