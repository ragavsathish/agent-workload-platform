import assert from "node:assert/strict";
import test from "node:test";

import {
  PublicTranscript,
  latestConversationPrompt,
  normalizeMessages,
  splitConversation,
} from "./dist/voice-agent-service.js";

test("keeps a bounded public transcript projection", () => {
  const transcript = new PublicTranscript();
  transcript.addUser("inspect the repository");
  const assistantId = transcript.beginAssistant();
  transcript.appendAssistantText(assistantId, "done");
  transcript.finishAssistant(assistantId);

  assert.deepEqual(
    transcript.snapshot().entries.map(({ role, text, status }) => ({ role, text, status })),
    [
      { role: "user", text: "inspect the repository", status: undefined },
      { role: "assistant", text: "done", status: "completed" },
    ],
  );
});

test("accepts only a user-ending normalized conversation", () => {
  const messages = normalizeMessages([
    { role: "system", content: "be precise" },
    { role: "user", content: "show the status" },
  ]);
  const split = splitConversation(messages);
  assert.equal(split.systemPrompt, "be precise");
  assert.equal(latestConversationPrompt(split.transcript), "show the status");
  assert.throws(
    () => latestConversationPrompt(normalizeMessages([
      { role: "user", content: "first" },
      { role: "assistant", content: "no" },
    ])),
    /conversation must end with a user message/,
  );
});
