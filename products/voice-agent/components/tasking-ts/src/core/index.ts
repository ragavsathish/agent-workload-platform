import request from "request";

const MAX_INSTRUCTION_CHARS = 20_000;
const MAX_WORKSPACE_CHARS = 4_096;
const MAX_PROPOSAL_ID_CHARS = 256;

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

function proposalPath(proposalId: string, action = ""): string {
  const id = requiredText(proposalId, "proposal ID", MAX_PROPOSAL_ID_CHARS);
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

function proposalId(payload: string): string {
  const parsed: unknown = JSON.parse(validPayload(payload));
  if (!parsed || typeof parsed !== "object" || !("id" in parsed)) {
    throw new Error("agent gateway created a proposal without an ID");
  }
  return requiredText(String(parsed.id), "proposal ID", MAX_PROPOSAL_ID_CHARS);
}

function call(method: "get" | "post", path: string, body?: string): string {
  return validPayload(request(method, path, body));
}

function proposeAgentTask(instruction: string, workspace: string): string {
  return call("post", "/tasks", taskRequest(instruction, workspace));
}

export function submitAgentTask(instruction: string, workspace: string): string {
  const proposed = proposeAgentTask(instruction, workspace);
  return approveAgentTask(proposalId(proposed));
}

export function getAgentTask(taskId: string): string {
  return call("get", proposalPath(taskId));
}

function approveAgentTask(proposalIdValue: string): string {
  return call("post", proposalPath(proposalIdValue, "/approve"), "{}");
}

export function cancelAgentTask(taskId: string): string {
  return call("post", proposalPath(taskId, "/cancel"), "{}");
}
