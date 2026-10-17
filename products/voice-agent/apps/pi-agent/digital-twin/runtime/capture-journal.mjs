import process from "node:process";

import { captureCognitiveJournal } from "../../dist/digital-twin/runtime/cognitive-journal.js";

let transcript = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) transcript += chunk;

if (!transcript.trim()) {
  console.error("Provide owner transcript text on stdin.");
  process.exitCode = 2;
} else {
  try {
    const capture = await captureCognitiveJournal(transcript, {
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
      sourceRef: process.env.DIGITAL_TWIN_SOURCE_REF,
    });
    process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Journal capture failed");
    process.exitCode = 1;
  }
}
