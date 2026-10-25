#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

const privateRoot = resolve(import.meta.dirname, "private-manifests");

function args(argv) {
  const result = { limit: 80 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!["--sessions", "--archived", "--from", "--through", "--output", "--limit"].includes(key)) {
      throw new Error(`unknown argument: ${key}`);
    }
    result[key.slice(2)] = argv[++i];
  }
  if (!["sessions", "archived", "from", "through", "output"].every((key) => result[key])) {
    throw new Error("required: --sessions DIR --archived DIR --from YYYY-MM-DD --through YYYY-MM-DD --output PRIVATE.json");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.from) || !/^\d{4}-\d{2}-\d{2}$/.test(result.through)
      || result.from > result.through) throw new Error("invalid date range");
  result.limit = Number(result.limit);
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > 500) throw new Error("--limit must be 1..500");
  result.output = resolve(result.output);
  if (!result.output.startsWith(`${privateRoot}${sep}`)) throw new Error("output must be inside ignored eval/private-manifests/");
  return result;
}

async function* jsonlFiles(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* jsonlFiles(path);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield path;
  }
}

const helsinkiDate = (timestamp) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(timestamp));

function candidate(record, sessionId, from, through) {
  const payload = record?.payload;
  if (record?.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") return null;
  const date = helsinkiDate(record.timestamp);
  if (date < from || date > through || !payload.id || !sessionId) return null;
  if (!Array.isArray(payload.content) || payload.content.length !== 1 || payload.content[0]?.type !== "input_text") return null;
  const transcript = payload.content[0].text?.trim();
  if (!transcript || transcript.startsWith("<environment_context>") || transcript.startsWith("<send_user_message_question_reply>")) return null;
  const id = createHash("sha256").update(`${sessionId}\0${payload.id}`).digest("hex").slice(0, 20);
  return {
    id: `codex-${id}`, sourceKind: "codex_user_role_unverified", sessionId, messageId: payload.id,
    timestamp: record.timestamp, transcript, ownerAuthored: null, privacyReviewed: false,
    annotationStatus: "pending", expectedKind: null, expectedProfileField: null,
    semanticFamilyId: null, errorSlice: null, reviewerNote: null,
  };
}

async function main() {
  const options = args(process.argv.slice(2));
  const cases = new Map();
  let files = 0;
  for (const root of [options.sessions, options.archived]) {
    for await (const path of jsonlFiles(resolve(root))) {
      files += 1;
      let sessionId;
      const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
      for await (const line of lines) {
        let record;
        try { record = JSON.parse(line); } catch { continue; }
        if (record.type === "session_meta") sessionId = record.payload?.session_id ?? record.payload?.id;
        const item = candidate(record, sessionId, options.from, options.through);
        if (item) cases.set(item.id, item);
      }
    }
  }
  const bySession = new Map();
  for (const item of cases.values()) {
    if (!bySession.has(item.sessionId)) bySession.set(item.sessionId, []);
    bySession.get(item.sessionId).push(item);
  }
  for (const bucket of bySession.values()) bucket.sort((a, b) => a.id.localeCompare(b.id));
  const selected = [];
  const sessionIds = [...bySession.keys()].sort();
  while (selected.length < options.limit) {
    let added = false;
    for (const sessionId of sessionIds) {
      const item = bySession.get(sessionId).shift();
      if (item) { selected.push(item); added = true; }
      if (selected.length >= options.limit) break;
    }
    if (!added) break;
  }
  const queue = {
    formatVersion: 1, purpose: "classifier_owner_turn_annotation_draft",
    sourceWindow: { from: options.from, through: options.through, timezone: "Europe/Helsinki" },
    privacyReview: "pending", labelAuthority: "human_review_required", cases: selected,
  };
  await mkdir(dirname(options.output), { recursive: true, mode: 0o700 });
  await writeFile(options.output, `${JSON.stringify(queue, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ filesScanned: files, distinctUserRoleMessages: cases.size,
    draftedCases: selected.length, output: options.output, status: "unreviewed" }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
