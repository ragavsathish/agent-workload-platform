import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  latestConversationPrompt,
  normalizeMessages,
  openVoiceSessionManager,
  parseEnvFile,
  splitConversation,
} from "./dist/voice-agent-service.js";

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

test("a persistent Pi session receives only the newest user turn", () => {
  const messages = normalizeMessages([
    { role: "system", content: "Be exact." },
    { role: "developer", content: "Say ready." },
    { role: "assistant", content: "Voice interface ready." },
    { role: "user", content: "Remember proposal p-1." },
    { role: "assistant", content: "Remembered proposal p-1." },
    { role: "user", content: "Which proposal?" },
  ]);
  const { transcript } = splitConversation(messages);
  assert.equal(latestConversationPrompt(transcript), "Which proposal?");
});

test("a persistent Pi session rejects a conversation without a final user turn", () => {
  assert.throws(
    () => latestConversationPrompt([{ role: "assistant", content: "Done." }]),
    /conversation must end with a user message/,
  );
});

test("the voice session manager reopens the same persisted Pi session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-session-test-"));
  const cwd = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  try {
    const created = openVoiceSessionManager(cwd, sessionDir);
    created.appendSessionInfo("voice-owner");
    created.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Voice interface ready." }],
      timestamp: Date.now(),
    });

    const reopened = openVoiceSessionManager(cwd, sessionDir);
    assert.equal(reopened.isPersisted(), true);
    assert.equal(reopened.getSessionId(), created.getSessionId());
    assert.equal(reopened.getSessionFile(), created.getSessionFile());
    assert.equal(reopened.getSessionName(), "voice-owner");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
