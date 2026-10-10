import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMessages, parseEnvFile, splitConversation } from "./dist/voice-agent-service.js";

test("parseEnvFile accepts the installed quoted environment format", () => {
  assert.deepEqual(parseEnvFile('A=one\nB="two words"\n# ignored\n'), {
    A: "one",
    B: "two words",
  });
});

test("voice messages keep the system prompt separate from the transcript", () => {
  const messages = normalizeMessages([
    { role: "system", content: "Be exact." },
    { role: "user", content: "Check p-1." },
  ]);
  assert.deepEqual(splitConversation(messages), {
    systemPrompt: "Be exact.",
    transcript: [{ role: "user", content: "Check p-1." }],
  });
});

test("voice messages require an actionable user or developer turn", () => {
  assert.throws(
    () => normalizeMessages([{ role: "system", content: "Be exact." }]),
    /user or developer message/,
  );
});

test("a Pipecat developer bootstrap becomes the first agent turn", () => {
  const messages = normalizeMessages([
    { role: "system", content: "Be exact." },
    { role: "developer", content: "Say ready." },
  ]);
  assert.deepEqual(splitConversation(messages), {
    systemPrompt: "Be exact.",
    transcript: [{ role: "user", content: "Say ready." }],
  });
});
