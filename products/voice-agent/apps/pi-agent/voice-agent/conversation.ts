type VoiceMessageRole = "system" | "developer" | "user" | "assistant";

type VoiceMessage = {
  role: VoiceMessageRole;
  content: string;
};

export type VoiceTurnRequest = {
  systemPrompt: string;
  prompt: string;
  origin: "user" | "developer";
};

export const VOICE_TURN_ORIGIN_CUSTOM_TYPE = "voice.turn-origin";

const MAX_MESSAGES = 64;
const MAX_CHARS = 64_000;
const roles = new Set<VoiceMessageRole>(["system", "developer", "user", "assistant"]);

function isVoiceMessageRole(value: unknown): value is VoiceMessageRole {
  return typeof value === "string" && roles.has(value as VoiceMessageRole);
}

/** Parse an untrusted conversation into the only two values needed to execute a voice turn. */
export function parseVoiceTurn(input: unknown): VoiceTurnRequest {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) {
    throw new Error("invalid message list");
  }
  let totalChars = 0;
  const messages = input.map((item): VoiceMessage => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("invalid message");
    }
    const role: unknown = (item as Record<string, unknown>).role;
    const rawContent = (item as Record<string, unknown>).content;
    if (!isVoiceMessageRole(role)) throw new Error("invalid message role");
    const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent ?? "");
    totalChars += content.length;
    return { role, content };
  });
  if (totalChars > MAX_CHARS) throw new Error("conversation is too large");
  if (!messages.some((message) => message.role === "user" || message.role === "developer")) {
    throw new Error("conversation must contain a user or developer message");
  }
  const finalMessage = messages.filter((message) => message.role !== "system").at(-1);
  if (!finalMessage || (finalMessage.role !== "user" && finalMessage.role !== "developer")) {
    throw new Error("conversation must end with a user message");
  }
  return {
    systemPrompt: messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n"),
    prompt: finalMessage.content,
    origin: finalMessage.role,
  };
}
