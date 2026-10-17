import process from "node:process";

import { identifyExplicitSkills } from "../../dist/digital-twin/runtime/ingestion.js";

let transcript = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) transcript += chunk;

if (!transcript.trim()) {
  console.error("Provide transcript text on stdin.");
  process.exitCode = 2;
} else {
  try {
    const skills = await identifyExplicitSkills(transcript, {
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
    });
    process.stdout.write(`${JSON.stringify({ skills }, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Skill identification failed");
    process.exitCode = 1;
  }
}
