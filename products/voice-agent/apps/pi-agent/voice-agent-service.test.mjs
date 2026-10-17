import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canManuallyCompact } from "./dist/voice-agent/voice-agent.js";
import {
  createWassetteMcpRegistration,
  isolatedVoiceMcpConfig,
  skillResourceLoader,
} from "./dist/voice-agent/pi-session.js";
import {
  PublicTranscript,
  publicSessionTranscript,
  restorePublicTranscript,
} from "./dist/voice-agent/public-transcript.js";
import { parseVoiceTurn } from "./dist/voice-agent/conversation.js";
import { createPersonalKnowledge } from "./dist/voice-agent/personal-knowledge.js";
import { parseEnvFile } from "./dist/voice-agent/voice-config.js";
import { matchVoiceRoute } from "./dist/voice-agent/voice-http-server.js";
import {
  createVoiceGondolinConfig,
  GUEST_GITEA_ENDPOINT,
  GUEST_PROMETHEUS_ENDPOINT,
  GUEST_S3MOCK_ENDPOINT,
  GUEST_SKILLS,
} from "./dist/voice-agent/voice-gondolin.js";
import {
  listVoiceSessions,
  openVoiceSessionManager,
  readVoiceSession,
} from "./dist/voice-agent/voice-sessions.js";

test("orchestrator Pi registers Wassette through native deferred MCP", async () => {
  const registrations = [];
  await createWassetteMcpRegistration({
    cwd: "/host/voice-workspace",
    wassetteBin: "/host/bin/wassette",
    wassetteComponentDir: "/host/runtime/wassette-components",
    wassetteEnvFile: "/host/runtime/wassette-tasking.env",
  })({
    registerMcpServer(name, config) {
      registrations.push({ name, config });
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "wassette");
  assert.deepEqual(registrations[0].config.args, [
    "run",
    "--component-dir",
    "/host/runtime/wassette-components",
    "--env-file",
    "/host/runtime/wassette-tasking.env",
  ]);
  assert.equal(registrations[0].config.exposure, "deferred");
  assert.equal(registrations[0].config.env.GITEA_TOKEN, "");
  assert.equal(registrations[0].config.env.ARTIFACT_SECRET_KEY, "");
  assert.equal(registrations[0].config.env.AWS_SESSION_TOKEN, "");
});

test("voice MCP ignores shared host and project MCP configuration", () => {
  assert.deepEqual(isolatedVoiceMcpConfig(), { servers: [], errors: [] });
});

test("voice HTTP routes parse into typed commands", () => {
  assert.deepEqual(
    matchVoiceRoute("POST", "/v1/sessions/session-1/resume"),
    { kind: "resume-session", sessionId: "session-1" },
  );
  assert.deepEqual(
    matchVoiceRoute("POST", "/v1/turn/stream"),
    { kind: "turn", stream: true },
  );
  assert.deepEqual(matchVoiceRoute("DELETE", "/v1/turn"), { kind: "not-found" });
});

test("persisted session history exposes text and tool status without private payloads", () => {
  const entries = [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-10-16T08:00:00Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Inspect it" }, { type: "image", data: "private" }],
        timestamp: 1,
      },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-10-16T08:00:01Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "hidden reasoning" },
          { type: "text", text: "I checked it." },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "/secret" } },
        ],
        timestamp: 2,
      },
    },
    {
      type: "message",
      id: "result-1",
      parentId: "assistant-1",
      timestamp: "2026-10-16T08:00:02Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "secret tool output" }],
        isError: false,
        timestamp: 3,
      },
    },
  ];

  assert.deepEqual(publicSessionTranscript(entries), [
    { id: "user-1", timestamp: 1, role: "user", text: "Inspect it" },
    {
      id: "assistant-1",
      timestamp: 2,
      role: "assistant",
      text: "I checked it.",
      status: "completed",
    },
    {
      id: "call-1",
      timestamp: 2,
      role: "tool",
      text: "read",
      status: "completed",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(publicSessionTranscript(entries)), /secret|hidden reasoning/);
});

test("service startup restores the active persisted transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-startup-transcript-test-"));
  const cwd = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  try {
    await Promise.all([mkdir(cwd), mkdir(sessionDir)]);
    const persisted = openVoiceSessionManager(cwd, sessionDir);
    persisted.appendMessage({
      role: "user",
      content: "Show this after restart.",
      timestamp: 1,
    });
    persisted.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Restored from the active session." }],
      timestamp: 2,
    });

    const reopened = openVoiceSessionManager(cwd, sessionDir);
    assert.deepEqual(
      restorePublicTranscript(reopened).snapshot().entries.map(({ role, text }) => ({
        role,
        text,
      })),
      [
        { role: "user", text: "Show this after restart." },
        { role: "assistant", text: "Restored from the active session." },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session catalog always includes the current in-memory voice session", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-history-test-"));
  const sessions = join(root, "sessions");
  const cwd = join(root, "workspace");
  try {
    await Promise.all([mkdir(sessions), mkdir(cwd)]);
    const catalog = await listVoiceSessions(cwd, sessions, "live-session");
    assert.equal(catalog.length, 1);
    assert.deepEqual(
      { ...catalog[0], updatedAt: "valid" },
      {
        id: "live-session",
        title: "Voice orchestrator",
        updatedAt: "valid",
        messageCount: 0,
        active: true,
      },
    );
    assert.ok(Number.isFinite(Date.parse(catalog[0].updatedAt)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent voice VM disables broken macOS QEMU idle resume", () => {
  const options = createVoiceGondolinConfig({
    giteaEndpointUrl: "http://127.0.0.1:3001",
    giteaOwner: "source-publisher",
    giteaToken: "read-only-token",
    imagePath: "/host/assets",
    localCwd: "/host/workspace",
    prometheusEndpointUrl: "http://127.0.0.1:9091",
    skillsDir: "/host/skills",
    s3MockAccessKey: "local-test",
    s3MockBucket: "agent-artifacts",
    s3MockEndpointUrl: "http://127.0.0.1:9090",
    s3MockSecretKey: "local-secret",
  });

  assert.equal(options.sandbox.qemuIdlePauseMs, 0);
});

test("reusable skills have a dedicated guest mount", () => {
  assert.equal(GUEST_SKILLS, "/skills");
});

test("Pi natively discovers mounted skills and exposes guest-readable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-skills-test-"));
  const skills = join(root, "skills");
  const skill = join(skills, "engineering", "diagnosing-bugs");
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  let explicitExtensionLoaded = false;
  try {
    await Promise.all([
      mkdir(skill, { recursive: true }),
      mkdir(agentDir),
      mkdir(cwd),
    ]);
    await writeFile(
      join(skill, "SKILL.md"),
      "---\nname: diagnosing-bugs\ndescription: Diagnose difficult bugs.\n---\n\n# Diagnose\n",
    );

    const loader = await skillResourceLoader(
      "Voice system prompt",
      { agentDir, cwd, skillsDir: skills },
      [() => { explicitExtensionLoaded = true; }],
    );
    const result = loader.getSkills();

    assert.deepEqual(result.diagnostics, []);
    assert.equal(result.skills.length, 1);
    assert.equal(explicitExtensionLoaded, true);
    assert.equal(result.skills[0].name, "diagnosing-bugs");
    assert.equal(
      result.skills[0].filePath,
      "/skills/engineering/diagnosing-bugs/SKILL.md",
    );
    assert.equal(result.skills[0].baseDir, "/skills/engineering/diagnosing-bugs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Gondolin mounts only writable runtime state and read-only skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-mount-test-"));
  const workspace = join(root, "workspace");
  const skills = join(root, "skills");
  try {
    await Promise.all([
      mkdir(workspace),
      mkdir(skills),
    ]);
    const mounts = createVoiceGondolinConfig({
      giteaEndpointUrl: "http://127.0.0.1:3001",
      giteaOwner: "source-publisher",
      giteaToken: "read-only-token",
      imagePath: join(root, "assets"),
      localCwd: workspace,
      prometheusEndpointUrl: "http://127.0.0.1:9091",
      skillsDir: skills,
      s3MockAccessKey: "local-test",
      s3MockBucket: "agent-artifacts",
      s3MockEndpointUrl: "http://127.0.0.1:9090",
      s3MockSecretKey: "local-test",
    }).mounts;
    assert.equal(mounts["/workspace"], workspace);
    assert.deepEqual(mounts["/skills"], { hostPath: skills, readonly: true });
    assert.deepEqual(Object.keys(mounts).sort(), ["/skills", "/workspace"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("voice Gondolin exposes only loopback S3Mock and read-only Gitea", async () => {
  const config = createVoiceGondolinConfig({
    giteaEndpointUrl: "http://127.0.0.1:3001",
    giteaOwner: "source-publisher",
    giteaToken: "read-only-token",
    imagePath: "/host/assets",
    localCwd: "/host/workspace",
    prometheusEndpointUrl: "http://127.0.0.1:9091",
    skillsDir: "/host/skills",
    s3MockAccessKey: "local-test",
    s3MockBucket: "agent-artifacts",
    s3MockEndpointUrl: "http://127.0.0.1:9090",
    s3MockSecretKey: "local-secret",
  });
  assert.equal(GUEST_S3MOCK_ENDPOINT, "http://s3mock.local:9090");
  assert.equal(config.environment.S3_ENDPOINT_URL, GUEST_S3MOCK_ENDPOINT);
  assert.equal(config.environment.S3_BUCKET, "agent-artifacts");
  assert.equal(config.environment.GITEA_BASE_URL, GUEST_GITEA_ENDPOINT);
  assert.equal(config.environment.GITEA_OWNER, "source-publisher");
  assert.equal(config.environment.PROMETHEUS_URL, GUEST_PROMETHEUS_ENDPOINT);

  const rewritten = await config.network.onRequest(
    new Request("http://s3mock.local:9090/agent-artifacts"),
  );
  assert.equal(rewritten.url, "http://127.0.0.1:9090/agent-artifacts");
  const gitea = await config.network.onRequest(
    new Request("http://gitea.local:3001/source-publisher/repository.git/info/refs"),
  );
  assert.equal(
    gitea.url,
    "http://127.0.0.1:3001/source-publisher/repository.git/info/refs",
  );
  const prometheus = await config.network.onRequest(
    new Request("http://prometheus.local:9091/api/v1/query?query=up"),
  );
  assert.equal(
    prometheus.url,
    "http://127.0.0.1:9091/api/v1/query?query=up",
  );
  const denied = await config.network.onRequest(new Request("http://example.com/"));
  assert.equal(denied.status, 403);
  assert.throws(
    () => createVoiceGondolinConfig({
      giteaEndpointUrl: "http://127.0.0.1:3001",
      giteaOwner: "source-publisher",
      giteaToken: "read-only-token",
      imagePath: "/host/assets",
      localCwd: "/host/workspace",
      skillsDir: "/host/skills",
      s3MockAccessKey: "local-test",
      s3MockBucket: "agent-artifacts",
      s3MockEndpointUrl: "https://s3.example.com",
      s3MockSecretKey: "local-secret",
    }),
    /HTTP loopback origin/,
  );
});

test("voice Pi queries bounded personal knowledge through the gateway", async () => {
  const requests = [];
  const knowledge = createPersonalKnowledge({
    baseUrl: "http://gateway.test/v1",
    token: "gateway-token",
    identity: "owner@example.com",
    fetch: async (url, init) => {
      requests.push({ url: String(url), method: init.method });
      return Response.json({ results: [] });
    },
  });

  assert.deepEqual(
    await knowledge.query({ scope: "learning", query: " DDD & EventStorming " }),
    { results: [] },
  );
  assert.deepEqual(requests, [{
    url: "http://gateway.test/v1/digital-twin?identity=owner%40example.com&scope=learning&query=DDD+%26+EventStorming",
    method: "GET",
  }]);
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

  transcript.reset();
  assert.deepEqual(transcript.snapshot().entries, []);
  assert.equal(transcript.snapshot().revision, 7);

  transcript.replace([
    { id: "persisted-user", timestamp: 7, role: "user", text: "Resume this." },
  ]);
  assert.deepEqual(transcript.snapshot().entries, [
    { id: "persisted-user", timestamp: 7, role: "user", text: "Resume this." },
  ]);
  assert.equal(transcript.snapshot().revision, 8);
});

test("a fresh voice session preserves the previous persisted conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-fresh-session-test-"));
  const cwd = join(root, "workspace");
  const sessionDir = join(root, "sessions");
  try {
    await Promise.all([mkdir(cwd), mkdir(sessionDir)]);
    const previous = openVoiceSessionManager(cwd, sessionDir);
    previous.appendMessage({
      role: "user",
      content: "Keep this conversation.",
      timestamp: 1,
    });
    const fresh = (await import("@earendil-works/pi-coding-agent")).SessionManager.create(
      cwd,
      sessionDir,
    );
    assert.notEqual(fresh.getSessionId(), previous.getSessionId());
    fresh.appendMessage({ role: "user", content: "Fresh context.", timestamp: 2 });

    const catalog = await listVoiceSessions(cwd, sessionDir, fresh.getSessionId());
    assert.equal(catalog.length, 2);
    assert.equal(catalog[0].id, fresh.getSessionId());
    assert.equal(catalog[0].active, true);
    assert.equal(
      readVoiceSession(cwd, sessionDir, previous.getSessionId()).entries[0].text,
      "Keep this conversation.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("voice messages keep the system prompt separate from the turn prompt", () => {
  assert.deepEqual(parseVoiceTurn([
    { role: "system", content: "Be exact." },
    { role: "user", content: "Check p-1." },
  ]), {
    systemPrompt: "Be exact.",
    prompt: "Check p-1.",
  });
});

test("voice messages require an actionable user or developer turn", () => {
  assert.throws(
    () => parseVoiceTurn([{ role: "system", content: "Be exact." }]),
    /user or developer message/,
  );
});

test("a Pipecat developer bootstrap becomes the first agent turn", () => {
  assert.deepEqual(parseVoiceTurn([
    { role: "system", content: "Be exact." },
    { role: "developer", content: "Say ready." },
  ]), {
    systemPrompt: "Be exact.",
    prompt: "Say ready.",
  });
});

test("a persistent Pi session receives only the newest user turn", () => {
  const turn = parseVoiceTurn([
    { role: "system", content: "Be exact." },
    { role: "developer", content: "Say ready." },
    { role: "assistant", content: "Voice interface ready." },
    { role: "user", content: "Remember proposal p-1." },
    { role: "assistant", content: "Remembered proposal p-1." },
    { role: "user", content: "Which proposal?" },
  ]);
  assert.equal(turn.prompt, "Which proposal?");
});

test("manual compaction follows Pi's retained-context boundary instead of a 64k gate", () => {
  assert.equal(canManuallyCompact(63_895, 20_000, false, "message"), true);
  assert.equal(canManuallyCompact(20_000, 20_000, false, "message"), false);
  assert.equal(canManuallyCompact(63_895, 20_000, true, "message"), false);
  assert.equal(canManuallyCompact(63_895, 20_000, false, "compaction"), false);
});

test("a persistent Pi session rejects a conversation without a final user turn", () => {
  assert.throws(
    () => parseVoiceTurn([
      { role: "user", content: "Do the work." },
      { role: "assistant", content: "Done." },
    ]),
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
