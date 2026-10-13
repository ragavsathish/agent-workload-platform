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
  PublicTranscript,
  splitConversation,
  submitAgentTask,
} from "./dist/voice-agent-service.js";
import {
  createGondolinTools,
  GUEST_SKILLS,
  toGondolinPath,
} from "./dist/gondolin-workspace.js";

test("voice Pi exposes its native coding tools through Gondolin", () => {
  const tools = createGondolinTools({ fs: {} }, "/host/workspace");
  assert.deepEqual(tools.map((tool) => tool.name), ["read", "write", "edit", "bash"]);
});

test("Gondolin tool paths stay inside the mounted workspace", () => {
  assert.equal(toGondolinPath("/host/workspace", "/host/workspace"), "/workspace");
  assert.equal(
    toGondolinPath("/host/workspace", "/host/workspace/src/app.ts"),
    "/workspace/src/app.ts",
  );
  assert.throws(
    () => toGondolinPath("/host/workspace", "/host/private.txt"),
    /path escapes workspace/,
  );
});

test("reusable skills have a dedicated guest mount", () => {
  assert.equal(GUEST_SKILLS, "/skills");
});

test("voice Pi can submit durable work directly to another Pi worker", async () => {
  const requests = [];
  const result = await submitAgentTask(
    async (method, path, body) => {
      requests.push({ method, path, body });
      return path === "/tasks"
        ? { id: "proposal-1", status: "pending" }
        : { id: "proposal-1", status: "queued" };
    },
    "owner@example.com",
    "Run the complete test suite.",
    "default",
  );

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/tasks",
      body: {
        identity: "owner@example.com",
        instruction: "Run the complete test suite.",
        workspace: "default",
      },
    },
    {
      method: "POST",
      path: "/tasks/proposal-1/approve",
      body: { identity: "owner@example.com" },
    },
  ]);
  assert.deepEqual(result, { id: "proposal-1", status: "queued" });
});

test("parseEnvFile accepts the installed quoted environment format", () => {
  assert.deepEqual(parseEnvFile('A=one\nB="two words"\n# ignored\n'), {
    A: "one",
    B: "two words",
  });
});

test("public transcript exposes text and tool status without tool payloads", () => {
  const transcript = new PublicTranscript();
  transcript.addUser("Inspect the repository.");
  const assistantId = transcript.beginAssistant();
  transcript.appendAssistantText(assistantId, "I will inspect it.");
  transcript.finishAssistant(assistantId);
  transcript.startTool("call-secret", "gondolin_bash");
  transcript.finishTool("call-secret", false);

  const snapshot = transcript.snapshot();
  assert.equal(snapshot.revision, 6);
  assert.deepEqual(
    snapshot.entries.map(({ role, text, status }) => ({ role, text, status })),
    [
      { role: "user", text: "Inspect the repository.", status: undefined },
      { role: "assistant", text: "I will inspect it.", status: "completed" },
      { role: "tool", text: "gondolin_bash", status: "completed" },
    ],
  );
  assert.doesNotMatch(JSON.stringify(snapshot), /argument|result|secret payload/);
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
