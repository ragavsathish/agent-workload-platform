import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canManuallyCompact,
  VOICE_INITIAL_TOOLS,
} from "./dist/voice-agent/voice-agent.js";
import {
  createGrafanaMcpRegistration,
  createJournalReviewMcpRegistration,
  createPlaywrightTraceMcpRegistration,
  createRemoteTaskSessionRegistration,
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
import { matchVoiceRoute, parseNarrationRequest } from "./dist/voice-agent/voice-http-server.js";
import { narrationPrompt } from "./dist/voice-agent/task-narrator.js";
import {
  createVoiceGondolinConfig,
  GUEST_GITEA_ENDPOINT,
  GUEST_OXIGRAPH_CLI,
  GUEST_OXIGRAPH_ENDPOINT,
  GUEST_PROMETHEUS_ENDPOINT,
  GUEST_S3MOCK_ENDPOINT,
  GUEST_SKILLS,
} from "./dist/voice-agent/voice-gondolin.js";
import {
  listVoiceSessions,
  openVoiceSessionManager,
  readVoiceSession,
} from "./dist/voice-agent/voice-sessions.js";

const promptEvent = () => ({ systemPromptOptions: { sections: {} } });

test("orchestrator Pi registers Wassette through native deferred MCP", async () => {
  const registrations = [];
  const handlers = new Map();
  await createWassetteMcpRegistration({
    cwd: "/host/voice-workspace",
    wassetteBin: "/host/bin/wassette",
    wassetteComponentDir: "/host/runtime/wassette-components",
    wassetteEnvFile: "/host/runtime/wassette-tasking.env",
  })({
    registerMcpServer(name, config) {
      registrations.push({ name, config });
    },
    on(event, handler) {
      handlers.set(event, handler);
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
  assert.equal(registrations[0].config.env.TASK_GATEWAY_TOKEN, "");
  assert.equal(registrations[0].config.env.KNOWLEDGE_GATEWAY_TOKEN, "");
  assert.equal(registrations[0].config.env.DIGITAL_TWIN_READER_TOKEN, "");
  const event = promptEvent();
  handlers.get("before_agent_start")(event);
  assert.match(event.systemPromptOptions.sections.wassette, /capability-controlled WebAssembly/u);
  assert.match(event.systemPromptOptions.sections.music, /review-gated/u);
});

test("voice initial tools do not turn MCP selection into an allowlist", () => {
  assert.ok(VOICE_INITIAL_TOOLS.length > 0);
  assert.ok(
    VOICE_INITIAL_TOOLS.every((name) => name.startsWith("+")),
    "plain tool names would hide deferred Wassette MCP tools",
  );
});

test("voice MCP ignores shared host and project MCP configuration", () => {
  assert.deepEqual(isolatedVoiceMcpConfig(), { servers: [], errors: [] });
});

test("orchestrator Pi keeps authenticated Grafana trace tools directly available", async () => {
  const registrations = [];
  const handlers = new Map();
  let activeTools = ["read"];
  await createGrafanaMcpRegistration({
    grafanaMcpToken: "caller-secret",
    grafanaMcpUrl: "http://127.0.0.1:8000/mcp",
  })({
    registerMcpServer(name, config) {
      registrations.push({ name, config });
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    getAllTools() {
      return [
        { name: "read" },
        { name: "mcp__grafana__search_tempo_traces" },
        { name: "mcp__grafana__get_tempo_trace" },
      ];
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(tools) {
      activeTools = tools;
    },
  });

  assert.deepEqual(registrations, [{
    name: "grafana",
    config: {
      url: "http://127.0.0.1:8000/mcp",
      headers: { Authorization: "Bearer caller-secret" },
      exposure: "direct",
      description: "Read Grafana dashboards, Prometheus metrics, and Tempo traces.",
      timeout: 30,
    },
  }]);
  const event = promptEvent();
  handlers.get("before_agent_start")(event);
  assert.match(event.systemPromptOptions.sections.grafana_trace, /Grafana MCP/u);
  assert.deepEqual(activeTools, [
    "read",
    "mcp__grafana__search_tempo_traces",
    "mcp__grafana__get_tempo_trace",
  ]);
});

test("orchestrator Pi keeps Playwright trace reads direct while narrated export stays deferred to Wassette", async () => {
  const registrations = [];
  const handlers = new Map();
  let activeTools = ["read"];
  await createPlaywrightTraceMcpRegistration({
    playwrightTraceViewerBaseUrl: "http://127.0.0.1:9450",
  })({
    registerMcpServer(name, config) {
      registrations.push({ name, config });
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    getAllTools() {
      return [
        { name: "read" },
        { name: "mcp__playwright_traces__search_playwright_traces" },
        { name: "mcp__playwright_traces__render_playwright_trace" },
      ];
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(names) {
      activeTools = names;
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "playwright-traces");
  assert.equal(registrations[0].config.url, "http://127.0.0.1:9450/mcp");
  assert.equal(registrations[0].config.timeout, 600);
  assert.equal(registrations[0].config.exposure, "direct");
  const event = promptEvent();
  handlers.get("before_agent_start")(event);
  assert.match(event.systemPromptOptions.sections.playwright_trace, /selectedPlaywrightTrace/u);
  assert.deepEqual(activeTools, [
    "read",
    "mcp__playwright_traces__search_playwright_traces",
    "mcp__playwright_traces__render_playwright_trace",
  ]);
});

test("orchestrator Pi keeps the journal review app directly available", async () => {
  const registrations = [];
  const handlers = new Map();
  let activeTools = ["read"];
  await createJournalReviewMcpRegistration()({
    registerMcpServer(name, config) {
      registrations.push({ name, config });
    },
    on(event, handler) {
      handlers.set(event, handler);
    },
    getAllTools() {
      return [
        { name: "read" },
        { name: "mcp__journal_review__render_journal_review" },
        { name: "mcp__journal_review__review_active" },
        { name: "mcp__journal_review__navigate_review" },
        { name: "mcp__journal_review__get_review_status" },
      ];
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(tools) {
      activeTools = tools;
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "journal-review");
  assert.equal(registrations[0].config.command, process.execPath);
  assert.match(
    registrations[0].config.args[0],
    /dist\/vendor\/journal-review-mcp\/stdio-bundle\.mjs$/u,
  );
  assert.equal(registrations[0].config.args[1], "--stdio");
  assert.match(
    registrations[0].config.env.JOURNAL_REVIEW_APP_HTML,
    /dist\/vendor\/journal-review-mcp\/app\/main\.html$/u,
  );
  assert.equal(registrations[0].config.exposure, "direct");
  const event = promptEvent();
  handlers.get("before_agent_start")(event);
  assert.match(event.systemPromptOptions.sections.journal_review, /Recogito/u);
  assert.deepEqual(activeTools, [
    "read",
    "mcp__journal_review__render_journal_review",
    "mcp__journal_review__review_active",
    "mcp__journal_review__navigate_review",
    "mcp__journal_review__get_review_status",
  ]);
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
  assert.deepEqual(
    matchVoiceRoute("POST", "/v1/tasks/detach"),
    { kind: "detach-task" },
  );
  assert.deepEqual(
    matchVoiceRoute("POST", "/v1/tasks/narration"),
    { kind: "task-narration" },
  );
  assert.deepEqual(matchVoiceRoute("DELETE", "/v1/turn"), { kind: "not-found" });
});

test("narration uses bounded task events in a separate prompt", () => {
  const request = parseNarrationRequest({
    taskId: "00000000-0000-0000-0000-000000000001",
    instruction: "Review the pull request",
    events: ["The agent is reading README.md.", "The agent is running: git diff."],
  });
  assert.match(narrationPrompt(request), /Review the pull request/u);
  assert.match(narrationPrompt(request), /2\. The agent is running: git diff\./u);
  assert.throws(() => parseNarrationRequest({ ...request, events: [] }), /invalid narration/u);
  assert.throws(() => parseNarrationRequest({ ...request, events: Array(41).fill("x") }), /invalid narration/u);
});

test("voice Pi exposes one task-session attachment tool", async () => {
  const tools = [];
  const attached = [];
  const handlers = new Map();
  await createRemoteTaskSessionRegistration({
    async attach(taskId) {
      attached.push(taskId);
      return { taskId, isStreaming: true };
    },
  })({
    registerTool(tool) { tools.push(tool); },
    on(event, handler) { handlers.set(event, handler); },
  });

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "attach_task_session");
  const event = promptEvent();
  handlers.get("before_agent_start")(event);
  assert.match(event.systemPromptOptions.sections.remote_task, /active conversational session/u);
  const taskId = "00000000-0000-0000-0000-000000000001";
  const result = await tools[0].execute("call-1", { task_id: taskId });
  assert.deepEqual(attached, [taskId]);
  assert.match(result.content[0].text, /next owner turn goes directly/u);
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
    giteaRepository: "agent-workload-platform",
    giteaToken: "read-only-token",
    imagePath: "/host/assets",
    oxigraphUrl: "http://127.0.0.1:7878",
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

test("Pi discovers only mounted Voice skills and exposes guest-readable paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-skills-test-"));
  const skills = join(root, "skills");
  const skill = join(skills, "engineering", "diagnosing-bugs");
  const autoSkill = join(root, "home", ".agents", "skills", "unexpected-global-skill");
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const previousHome = process.env.HOME;
  const originalReaddirSync = fs.readdirSync;
  let scannedGlobalSkills = false;
  let explicitExtensionLoaded = false;
  try {
    await Promise.all([
      mkdir(skill, { recursive: true }),
      mkdir(autoSkill, { recursive: true }),
      mkdir(agentDir),
      mkdir(cwd),
    ]);
    await writeFile(
      join(skill, "SKILL.md"),
      "---\nname: diagnosing-bugs\ndescription: Diagnose difficult bugs.\n---\n\n# Diagnose\n",
    );
    await writeFile(
      join(autoSkill, "SKILL.md"),
      "---\nname: unexpected-global-skill\ndescription: Must not enter the Voice session.\n---\n",
    );
    process.env.HOME = join(root, "home");
    fs.readdirSync = function guardedReaddirSync(directory, options) {
      if (String(directory).startsWith(join(root, "home", ".agents", "skills"))) {
        scannedGlobalSkills = true;
      }
      return originalReaddirSync.call(this, directory, options);
    };
    syncBuiltinESMExports();

    const loader = await skillResourceLoader(
      "Voice system prompt",
      { agentDir, cwd, skillsDir: skills },
      [() => { explicitExtensionLoaded = true; }],
    );
    const result = loader.getSkills();

    assert.deepEqual(result.diagnostics, []);
    assert.equal(scannedGlobalSkills, false);
    assert.equal(process.env.HOME, join(root, "home"));
    assert.equal(result.skills.length, 1);
    assert.equal(explicitExtensionLoaded, true);
    assert.equal(result.skills[0].name, "diagnosing-bugs");
    assert.equal(
      result.skills[0].filePath,
      "/skills/engineering/diagnosing-bugs/SKILL.md",
    );
    assert.equal(result.skills[0].baseDir, "/skills/engineering/diagnosing-bugs");
  } finally {
    fs.readdirSync = originalReaddirSync;
    syncBuiltinESMExports();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
});

test("voice Gondolin mounts only skills and clones committed source into guest storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-voice-mount-test-"));
  const skills = join(root, "skills");
  try {
    await mkdir(skills);
    const config = createVoiceGondolinConfig({
      giteaEndpointUrl: "http://127.0.0.1:3001",
      giteaOwner: "source-publisher",
      giteaRepository: "agent-workload-platform",
      giteaToken: "read-only-token",
      imagePath: join(root, "assets"),
      oxigraphUrl: "http://127.0.0.1:7878",
      prometheusEndpointUrl: "http://127.0.0.1:9091",
      skillsDir: skills,
      s3MockAccessKey: "local-test",
      s3MockBucket: "agent-artifacts",
      s3MockEndpointUrl: "http://127.0.0.1:9090",
      s3MockSecretKey: "local-test",
    });
    assert.deepEqual(config.mounts, { "/skills": { hostPath: skills, readonly: true } });
    assert.equal(config.mountOutput, false);
    assert.deepEqual(config.startupCommands[1], [
      "/usr/bin/git", "clone", "--depth", "1", "--single-branch", "--branch", "main",
      "http://gitea.local:3001/source-publisher/agent-workload-platform.git", "/workspace",
    ]);
    assert.equal(GUEST_OXIGRAPH_CLI, "/opt/awp/bin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("voice Gondolin exposes allowlisted loopback services including raw Oxigraph", async () => {
  const config = createVoiceGondolinConfig({
    giteaEndpointUrl: "http://127.0.0.1:3001",
    giteaOwner: "source-publisher",
    giteaRepository: "agent-workload-platform",
    giteaToken: "read-only-token",
    imagePath: "/host/assets",
    oxigraphUrl: "http://127.0.0.1:7878",
    prometheusEndpointUrl: "http://127.0.0.1:9091",
    skillsDir: "/host/skills",
    s3MockAccessKey: "local-test",
    s3MockBucket: "agent-artifacts",
    s3MockEndpointUrl: "http://127.0.0.1:9090",
    s3MockSecretKey: "local-secret",
  });
  assert.equal(GUEST_S3MOCK_ENDPOINT, "http://s3mock.local:9090");
  assert.equal(config.environment.S3_ENDPOINT_URL, GUEST_S3MOCK_ENDPOINT);
  assert.match(config.environment.PATH, /(?:^|:)\/usr\/local\/bin(?:$|:)/);
  assert.equal(config.environment.S3_BUCKET, "agent-artifacts");
  assert.equal(config.environment.GITEA_BASE_URL, GUEST_GITEA_ENDPOINT);
  assert.equal(config.environment.GITEA_OWNER, "source-publisher");
  assert.equal(config.environment.PROMETHEUS_URL, GUEST_PROMETHEUS_ENDPOINT);
  assert.equal(config.environment.OXIGRAPH_URL, GUEST_OXIGRAPH_ENDPOINT);

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
  const oxigraph = await config.network.onRequest(
    new Request("http://oxigraph.local:7878/query"),
  );
  assert.equal(oxigraph.url, "http://127.0.0.1:7878/query");
  const denied = await config.network.onRequest(new Request("http://example.com/"));
  assert.equal(denied.status, 403);
  assert.throws(
    () => createVoiceGondolinConfig({
      giteaEndpointUrl: "http://127.0.0.1:3001",
      giteaOwner: "source-publisher",
      giteaRepository: "agent-workload-platform",
      giteaToken: "read-only-token",
      imagePath: "/host/assets",
      oxigraphUrl: "http://127.0.0.1:7878",
      skillsDir: "/host/skills",
      s3MockAccessKey: "local-test",
      s3MockBucket: "agent-artifacts",
      s3MockEndpointUrl: "https://s3.example.com",
      s3MockSecretKey: "local-secret",
    }),
    /HTTP loopback origin/,
  );
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
    origin: "user",
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
    origin: "developer",
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
