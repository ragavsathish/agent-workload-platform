import request from "request";

const MAX_INSTRUCTION_CHARS = 20_000;
const MAX_WORKSPACE_CHARS = 4_096;
const MAX_TASK_ID_CHARS = 256;
const MAX_GENERATION_ID_CHARS = 256;
const MAX_SESSION_NAME_CHARS = 200;
const MAX_STYLE_CHARS = 1_000;
const MAX_NARRATION_BRIEF_CHARS = 2_000;
const OPAQUE_ID = /^[a-f0-9]{32}$/u;

function requiredText(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  if (normalized.length > maximum) throw new Error(`${name} exceeds ${maximum} characters`);
  return normalized;
}

function taskRequest(instruction: string, workspace: string): string {
  return JSON.stringify({
    instruction: requiredText(instruction, "instruction", MAX_INSTRUCTION_CHARS),
    workspace: requiredText(workspace, "workspace", MAX_WORKSPACE_CHARS),
  });
}

function taskPath(taskId: string, action = ""): string {
  const id = requiredText(taskId, "task ID", MAX_TASK_ID_CHARS);
  return `/tasks/${encodeURIComponent(id)}${action}`;
}

function validPayload(payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("agent gateway returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("agent gateway returned an invalid task response");
  }
  return JSON.stringify(parsed);
}

function singleTask(payload: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("agent gateway returned invalid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("task session name did not resolve to exactly one task");
  }
  return validPayload(JSON.stringify(parsed[0]));
}

function call(method: "get" | "post", path: string, body?: string): string {
  return validPayload(request(method, path, body));
}

export function submitAgentTask(instruction: string, workspace: string): string {
  return call("post", "/tasks", taskRequest(instruction, workspace));
}

export function getAgentTask(taskId: string): string {
  return call("get", taskPath(taskId));
}

export function findAgentTask(sessionName: string): string {
  const name = requiredText(sessionName, "session name", MAX_SESSION_NAME_CHARS);
  const path = `/tasks?session_name=${encodeURIComponent(name)}&limit=2`;
  return singleTask(request("get", path, undefined));
}

export function cancelAgentTask(taskId: string): string {
  return call("post", taskPath(taskId, "/cancel"), "{}");
}

function opaqueId(value: string, name: string): string {
  const id = value.trim();
  if (!OPAQUE_ID.test(id)) throw new Error(`${name} must be a 32-character lowercase hex ID`);
  return id;
}

export function submitTraceRender(traceId: string, narrationBrief: string): string {
  return call("post", "/api/trace-explainers", JSON.stringify({
    traceId: opaqueId(traceId, "trace ID"),
    narrationBrief: requiredText(
      narrationBrief,
      "narration brief",
      MAX_NARRATION_BRIEF_CHARS,
    ),
  }));
}

export function getTraceRender(renderId: string): string {
  return call("get", `/api/trace-explainers/${opaqueId(renderId, "render ID")}`);
}

function generationPath(generationId: string, action = ""): string {
  const id = requiredText(generationId, "generation ID", MAX_GENERATION_ID_CHARS);
  return `/music/generations/${encodeURIComponent(id)}${action}`;
}

export function submitSong(
  brief: string,
  workspace: string,
  style: string,
  durationSeconds: number,
): string {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 300) {
    throw new Error("duration seconds must be an integer from 30 to 300");
  }
  return call("post", "/music/generations", JSON.stringify({
    brief: requiredText(brief, "brief", MAX_INSTRUCTION_CHARS),
    workspace: requiredText(workspace, "workspace", MAX_WORKSPACE_CHARS),
    style: requiredText(style, "style", MAX_STYLE_CHARS),
    durationSeconds,
  }));
}

export function getSong(generationId: string): string {
  return call("get", generationPath(generationId));
}

export function renderSong(generationId: string): string {
  return call("post", generationPath(generationId, "/render"), "{}");
}

export function cancelSong(generationId: string): string {
  return call("post", generationPath(generationId, "/cancel"), "{}");
}
