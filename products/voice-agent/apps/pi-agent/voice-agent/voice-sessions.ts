import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  type PublicTranscriptEntry,
  publicSessionTranscript,
} from "./public-transcript.js";

export type PublicSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
};

function sessionTitle(name: string | undefined, firstMessage: string): string {
  const value = (name?.trim() || firstMessage.trim() || "Untitled session")
    .replace(/\s+/g, " ");
  return value.length > 72 ? `${value.slice(0, 69)}…` : value;
}

export async function listVoiceSessions(
  cwd: string,
  sessionDir: string,
  activeId: string,
): Promise<PublicSessionSummary[]> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const catalog = sessions.slice(0, 30).map((session) => ({
    id: session.id,
    title: sessionTitle(session.name, session.firstMessage),
    updatedAt: session.modified.toISOString(),
    messageCount: session.messageCount,
    active: session.id === activeId,
  }));
  if (!catalog.some((session) => session.active)) {
    catalog.unshift({
      id: activeId,
      title: "Voice orchestrator",
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      active: true,
    });
  }
  return catalog.slice(0, 30).sort(
    (left, right) => Number(right.active) - Number(left.active),
  );
}

export function readVoiceSession(
  cwd: string,
  sessionDir: string,
  sessionId: string,
): { revision: number; entries: PublicTranscriptEntry[] } | undefined {
  const path = SessionManager.findById(cwd, sessionId, sessionDir);
  if (!path) return undefined;
  const manager = SessionManager.open(path, sessionDir, cwd);
  const branch = manager.getBranch();
  return { revision: branch.length, entries: publicSessionTranscript(branch) };
}

export function openVoiceSessionManager(cwd: string, sessionDir: string): SessionManager {
  return SessionManager.continueRecent(cwd, sessionDir);
}
