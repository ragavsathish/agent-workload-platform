import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";

import { RemoteTaskSession } from "./dist/voice-agent/remote-task-session.js";

test("remote task session attaches and sends a conversational Pi RPC turn", async () => {
  const taskId = "00000000-0000-0000-0000-000000000001";
  const directory = `/tmp/awp-rpc-test-${process.pid}-${Date.now()}`;
  const path = join(directory, `${taskId}.sock`);
  await mkdir(directory, { mode: 0o700 });
  const commands = [];
  const server = createServer((socket) => {
    socket.write(`${JSON.stringify({ type: "remote_attached", taskId })}\n`);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const command = JSON.parse(raw);
        commands.push(command.type);
        if (command.type === "get_state") {
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            command: "get_state",
            success: true,
            data: { isStreaming: false, messageCount: 2 },
          })}\n`);
        } else if (command.type === "prompt") {
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            command: "prompt",
            success: true,
            data: { disposition: "started" },
          })}\n`);
          socket.write(`${JSON.stringify({ type: "turn_start" })}\n`);
          socket.write(`${JSON.stringify({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Working safely." },
          })}\n`);
          socket.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
        } else if (command.type === "get_last_assistant_text") {
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            command: "get_last_assistant_text",
            success: true,
            data: { text: "Working safely." },
          })}\n`);
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  const remote = new RemoteTaskSession(directory, 2_000);
  try {
    assert.deepEqual(await remote.attach(taskId), {
      taskId,
      isStreaming: false,
      messageCount: 2,
    });
    const deltas = [];
    assert.equal(await remote.send("What are you doing?", (delta) => deltas.push(delta)), "Working safely.");
    assert.deepEqual(deltas, ["Working safely."]);
    assert.deepEqual(commands, ["get_state", "get_state", "prompt", "get_last_assistant_text"]);
  } finally {
    await remote.detach();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test("remote task attachment reports a missing socket immediately", async () => {
  const directory = `/tmp/awp-rpc-missing-${process.pid}-${Date.now()}`;
  const remote = new RemoteTaskSession(directory, 2_000);
  const started = Date.now();
  await assert.rejects(
    remote.attach("00000000-0000-0000-0000-000000000002"),
    /ENOENT|closed|unavailable/u,
  );
  assert.ok(Date.now() - started < 1_000);
});

test("remote turn ignores an older settlement that races with a steer", async () => {
  const taskId = "00000000-0000-0000-0000-000000000003";
  const directory = `/tmp/awp-rpc-race-${process.pid}-${Date.now()}`;
  const path = join(directory, `${taskId}.sock`);
  await mkdir(directory, { mode: 0o700 });
  let lastTextRequests = 0;
  const server = createServer((socket) => {
    socket.write(`${JSON.stringify({ type: "remote_attached", taskId })}\n`);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\n")) {
        const newline = buffer.indexOf("\n");
        const raw = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!raw) continue;
        const command = JSON.parse(raw);
        if (command.type === "get_state") {
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            success: true,
            data: { isStreaming: true, messageCount: 3 },
          })}\n`);
        } else if (command.type === "prompt") {
          socket.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            success: true,
            data: { disposition: "steered" },
          })}\n`);
          setTimeout(() => socket.write(`${JSON.stringify({ type: "agent_settled" })}\n`), 25);
        } else if (command.type === "get_last_assistant_text") {
          lastTextRequests += 1;
          socket.write(`${JSON.stringify({
            id: command.id,
            type: "response",
            success: true,
            data: { text: "New response." },
          })}\n`);
        }
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  const remote = new RemoteTaskSession(directory, 2_000);
  try {
    await remote.attach(taskId);
    assert.equal(await remote.send("Please explain."), "New response.");
    assert.equal(lastTextRequests, 1);
  } finally {
    await remote.detach();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
