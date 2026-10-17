import { type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";

export type PublicTranscriptEntry = {
  id: string;
  timestamp: number;
  role: "user" | "assistant" | "tool";
  text: string;
  status?: "running" | "completed" | "failed";
};

export type PublicTranscriptSnapshot = {
  revision: number;
  entries: PublicTranscriptEntry[];
};

type TranscriptState = PublicTranscriptSnapshot & { nextId: number };
type TranscriptEvent =
  | {
    type: "append";
    entry: Omit<PublicTranscriptEntry, "id" | "timestamp">;
    id: string;
    timestamp: number;
    generatedId: boolean;
  }
  | { type: "assistant-delta"; id: string; delta: string }
  | { type: "assistant-finished"; id: string }
  | { type: "tool-finished"; id: string; failed: boolean }
  | { type: "reset" }
  | { type: "replace"; entries: PublicTranscriptEntry[] };

const MAX_ENTRIES = 200;
const MAX_TEXT_CHARS = 24_000;

function replaceAt<T>(values: readonly T[], index: number, value: T): T[] {
  return values.map((current, currentIndex) => currentIndex === index ? value : current);
}

function reduceTranscript(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  if (event.type === "append") {
    const entries = [...state.entries, {
      ...event.entry,
      id: event.id,
      timestamp: event.timestamp,
      text: event.entry.text.slice(0, MAX_TEXT_CHARS),
    }].slice(-MAX_ENTRIES);
    return {
      entries,
      nextId: state.nextId + Number(event.generatedId),
      revision: state.revision + 1,
    };
  }
  if (event.type === "reset") {
    return { ...state, entries: [], revision: state.revision + 1 };
  }
  if (event.type === "replace") {
    return {
      ...state,
      entries: event.entries.slice(-MAX_ENTRIES).map((entry) => ({ ...entry })),
      revision: state.revision + 1,
    };
  }

  const index = state.entries.findIndex((entry) =>
    entry.id === event.id
    && (event.type === "tool-finished" ? entry.role === "tool" : entry.role === "assistant"));
  if (index < 0) return state;
  const current = state.entries[index];
  if (event.type === "assistant-delta") {
    if (current.role !== "assistant" || current.status !== "running") return state;
    const entries = replaceAt(state.entries, index, {
      ...current,
      text: (current.text + event.delta).slice(0, MAX_TEXT_CHARS),
    });
    return { ...state, entries, revision: state.revision + 1 };
  }
  if (event.type === "assistant-finished") {
    const entries = current.text.trim()
      ? replaceAt(state.entries, index, { ...current, status: "completed" })
      : state.entries.filter((_entry, entryIndex) => entryIndex !== index);
    return { ...state, entries, revision: state.revision + 1 };
  }
  if (current.role !== "tool") return state;
  const entries = replaceAt(state.entries, index, {
    ...current,
    status: event.failed ? "failed" : "completed",
  });
  return { ...state, entries, revision: state.revision + 1 };
}

function safeToolName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 80) || "tool";
}

/** A bounded, display-safe projection of Pi events for the owner-only browser UI. */
export class PublicTranscript {
  private state: TranscriptState = { entries: [], nextId: 1, revision: 0 };

  private append(
    entry: Omit<PublicTranscriptEntry, "id" | "timestamp">,
    requestedId?: string,
  ): string {
    const requested = requestedId?.slice(0, 128);
    const id = requested || String(this.state.nextId);
    this.state = reduceTranscript(this.state, {
      type: "append",
      entry,
      id,
      timestamp: Date.now(),
      generatedId: !requested,
    });
    return id;
  }

  addUser(text: string): void {
    this.append({ role: "user", text });
  }

  beginAssistant(): string {
    return this.append({ role: "assistant", text: "", status: "running" });
  }

  appendAssistantText(id: string, delta: string): void {
    this.state = reduceTranscript(this.state, { type: "assistant-delta", id, delta });
  }

  finishAssistant(id: string): void {
    this.state = reduceTranscript(this.state, { type: "assistant-finished", id });
  }

  startTool(toolCallId: string, toolName: string): void {
    this.append({ role: "tool", text: safeToolName(toolName), status: "running" }, toolCallId);
  }

  finishTool(toolCallId: string, failed: boolean): void {
    this.state = reduceTranscript(this.state, {
      type: "tool-finished",
      id: toolCallId.slice(0, 128),
      failed,
    });
  }

  snapshot(): PublicTranscriptSnapshot {
    return {
      revision: this.state.revision,
      entries: this.state.entries.map((entry) => ({ ...entry })),
    };
  }

  reset(): void {
    this.state = reduceTranscript(this.state, { type: "reset" });
  }

  replace(entries: PublicTranscriptEntry[]): void {
    this.state = reduceTranscript(this.state, { type: "replace", entries });
  }
}

function publicMessageText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, MAX_TEXT_CHARS);
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) return [];
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("")
    .slice(0, MAX_TEXT_CHARS);
}

/** Project a persisted Pi branch without exposing reasoning, tool input, or tool output. */
export function publicSessionTranscript(entries: SessionEntry[]): PublicTranscriptEntry[] {
  const results = new Map<string, boolean>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      results.set(entry.message.toolCallId, entry.message.isError);
    }
  }
  const projected: PublicTranscriptEntry[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    const timestamp = Number.isFinite(message.timestamp)
      ? message.timestamp
      : Date.parse(entry.timestamp);
    if (message.role === "user") {
      const text = publicMessageText(message.content);
      if (text) projected.push({ id: entry.id, timestamp, role: "user", text });
      continue;
    }
    if (message.role !== "assistant") continue;
    const text = publicMessageText(message.content);
    if (text) {
      projected.push({ id: entry.id, timestamp, role: "assistant", text, status: "completed" });
    }
    for (const part of message.content) {
      if (part.type !== "toolCall") continue;
      const failed = results.get(part.id);
      projected.push({
        id: part.id.slice(0, 128),
        timestamp,
        role: "tool",
        text: safeToolName(part.name),
        status: failed === undefined ? "running" : failed ? "failed" : "completed",
      });
    }
  }
  return projected.slice(-MAX_ENTRIES);
}

export function restorePublicTranscript(sessionManager: SessionManager): PublicTranscript {
  const transcript = new PublicTranscript();
  transcript.replace(publicSessionTranscript(sessionManager.getBranch()));
  return transcript;
}
