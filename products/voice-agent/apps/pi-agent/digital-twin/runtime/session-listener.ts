import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";

import { SessionManager, type SessionEntry } from "@earendil-works/pi-coding-agent";

export type CompletedOwnerTurn = {
  sessionId: string;
  messageId: string;
  transcript: string;
  capturedAt: string;
};

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n")
    .trim();
}

function isoTimestamp(entry: SessionEntry): string {
  const raw = (entry as unknown as Record<string, unknown>).timestamp;
  if (typeof raw === "string" && Number.isFinite(Date.parse(raw))) {
    return new Date(raw).toISOString();
  }
  if (entry.type === "message") {
    const timestamp = (entry.message as unknown as Record<string, unknown>).timestamp;
    if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return new Date(0).toISOString();
}

export function completedOwnerTurns(
  sessionId: string,
  entries: SessionEntry[],
): CompletedOwnerTurn[] {
  const completed: CompletedOwnerTurn[] = [];
  let pending: CompletedOwnerTurn[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    if (entry.message.role === "user") {
      const transcript = messageText(entry.message.content);
      if (transcript) {
        pending.push({
          sessionId,
          messageId: entry.id,
          transcript,
          capturedAt: isoTimestamp(entry),
        });
      }
    } else if (entry.message.role === "assistant" && pending.length > 0) {
      completed.push(...pending);
      pending = [];
    }
  }
  return completed;
}

async function readSeen(path: string): Promise<Set<string> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeSeen(path: string, seen: Set<string>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.part`;
  await writeFile(temporary, `${JSON.stringify([...seen].sort())}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function enqueueTurn(
  turn: CompletedOwnerTurn,
  settings: { gatewayBaseUrl: string; gatewayToken: string; identity: string },
): Promise<void> {
  const response = await fetch(`${settings.gatewayBaseUrl.replace(/\/$/, "")}/digital-twin/ingestions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${settings.gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      identity: settings.identity,
      sessionId: turn.sessionId,
      messageId: turn.messageId,
      transcript: turn.transcript,
      capturedAt: turn.capturedAt,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`digital twin enqueue failed with ${response.status}`);
}

async function scan(
  sessionDir: string,
  seen: Set<string>,
  settings: { gatewayBaseUrl: string; gatewayToken: string; identity: string },
): Promise<boolean> {
  let changed = false;
  const sessions = await SessionManager.listAll(sessionDir);
  for (const session of sessions.sort((left, right) => left.created.getTime() - right.created.getTime())) {
    const manager = SessionManager.open(session.path, sessionDir, session.cwd);
    for (const turn of completedOwnerTurns(session.id, manager.getBranch())) {
      const key = `${turn.sessionId}:${turn.messageId}`;
      if (seen.has(key)) continue;
      await enqueueTurn(turn, settings);
      seen.add(key);
      changed = true;
    }
  }
  return changed;
}

async function baseline(sessionDir: string): Promise<Set<string>> {
  const seen = new Set<string>();
  const sessions = await SessionManager.listAll(sessionDir);
  for (const session of sessions) {
    const manager = SessionManager.open(session.path, sessionDir, session.cwd);
    for (const turn of completedOwnerTurns(session.id, manager.getBranch())) {
      seen.add(`${turn.sessionId}:${turn.messageId}`);
    }
  }
  return seen;
}

async function main(): Promise<void> {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const sessionDir = required("PI_VOICE_SESSION_DIR");
  const statePath = process.env.DIGITAL_TWIN_LISTENER_STATE?.trim()
    || join(sessionDir, ".digital-twin-listener.json");
  const settings = {
    gatewayBaseUrl: required("AGENT_GATEWAY_BASE_URL"),
    gatewayToken: required("AGENT_GATEWAY_TOKEN"),
    identity: required("ORCHESTRATOR_ALLOWED_USERS"),
  };
  if (settings.identity.includes(",")) throw new Error("digital twin listener requires one owner identity");
  const existing = await readSeen(statePath);
  const seen = existing ?? await baseline(sessionDir);
  if (existing === undefined) await writeSeen(statePath, seen);
  let stopping = false;
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  while (!stopping) {
    try {
      if (await scan(sessionDir, seen, settings)) await writeSeen(statePath, seen);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

if (process.argv[1]?.endsWith("session-listener.js")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
