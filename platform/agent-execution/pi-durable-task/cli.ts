#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { join } from "node:path";

type Reply = { success: boolean; data?: unknown; error?: string };

async function owner(command: string, fields: Record<string, unknown>): Promise<unknown> {
  const path = process.env.PI_DURABLE_OWNER_SOCKET
    ?? join("/tmp", `awp-pi-owner-${process.getuid?.() ?? 0}`, "owner.sock");
  const reply = await new Promise<Reply>((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: randomUUID(), command, ...fields })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline >= 0) { socket.end(); resolve(JSON.parse(buffer.slice(0, newline)) as Reply); }
    });
    socket.on("error", reject);
  });
  if (!reply.success) throw new Error(reply.error ?? "Pi Durable owner rejected the command");
  return reply.data;
}

function option(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = args[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  let result: unknown;
  if (command === "submit") {
    const identity = option(args, "--identity").trim().toLowerCase();
    const workspace = option(args, "--workspace").trim();
    const instruction = option(args, "--instruction").trim();
    if (identity.length < 3 || identity.length > 320 || !workspace || !instruction || instruction.length > 8_000) {
      throw new Error("identity, workspace, or instruction is invalid");
    }
    const requestId = randomUUID();
    result = await owner("submit", { requestId, input: {
      kind: "agent-run", requestId,
      params: { identity, workspace, instruction, native_cli: true },
    } });
  } else if (command === "get") {
    result = await owner("get", { taskId: option(args, "--task-id") });
  } else if (command === "list") {
    result = await owner("list_native", { identity: option(args, "--identity").trim().toLowerCase(), limit: 50 });
  } else if (command === "abort") {
    result = await owner("abort", { taskId: option(args, "--task-id") });
  } else {
    throw new Error("Usage: cli {submit --identity EMAIL --workspace NAME --instruction TEXT|get --task-id UUID|list --identity EMAIL|abort --task-id UUID}");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
