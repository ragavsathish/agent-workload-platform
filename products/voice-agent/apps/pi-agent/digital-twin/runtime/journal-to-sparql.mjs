import process from "node:process";

import { cognitiveJournalSparql } from "../../dist/digital-twin/runtime/cognitive-journal.js";

let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;

try {
  const capture = JSON.parse(input);
  process.stdout.write(cognitiveJournalSparql(capture, process.env.DIGITAL_TWIN_JOURNAL_GRAPH));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Journal serialization failed");
  process.exitCode = 1;
}
