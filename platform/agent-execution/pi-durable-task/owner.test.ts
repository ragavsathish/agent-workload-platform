import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

type Reply = { success: boolean; data?: unknown; error?: string };

async function request(path: string, command: string, fields: object = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    let buffer = "";
    socket.on("connect", () => socket.write(`${JSON.stringify({ id: randomUUID(), command, ...fields })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)) as Reply);
    });
    socket.on("error", reject);
  });
}

async function startOwner(store: string, socket: string, restartLimit = 5,
  extraEnv: Record<string, string> = {}): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(import.meta.dirname, "owner-server.js")], {
    env: {
      ...process.env,
      PI_DURABLE_OWNER_STORE: store,
      PI_DURABLE_OWNER_SOCKET: socket,
      PI_DURABLE_OWNER_RESTART_LIMIT: String(restartLimit),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let output = "";
    child.stdout!.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("pi-durable-owner ready")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`owner exited before ready: ${code}`)));
    child.once("error", reject);
  });
  return child;
}

async function stopOwner(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill(signal);
  });
}

async function waitState(socket: string, taskId: string, expected: string): Promise<unknown> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const reply = await request(socket, "get", { taskId });
    assert.equal(reply.success, true, reply.error);
    if ((reply.data as { state?: string })?.state === expected) return reply.data;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`task ${taskId} did not reach ${expected}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

test("authenticated HTTP transport reaches the same native task owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-owner-http-"));
  const store = join(directory, "owner.sqlite");
  const socket = join(directory, "owner.sock");
  const tokenFile = join(directory, "token");
  const token = "test-owner-token-000000000000000000000000";
  await writeFile(tokenFile, token);
  const port = await freePort();
  let child: ChildProcess | undefined;
  try {
    child = await startOwner(store, socket, 5, {
      PI_DURABLE_OWNER_TOKEN_FILE: tokenFile, PI_DURABLE_OWNER_PORT: String(port),
    });
    const url = `http://127.0.0.1:${port}/private/task`;
    const requestId = randomUUID();
    const body = JSON.stringify({ id: "http-test", command: "submit", requestId,
      input: { text: "HTTP owner result", holdMs: 0 } });
    assert.equal((await fetch(url, { method: "POST", body })).status, 401);
    const accepted = await fetch(url, { method: "POST", body,
      headers: { Authorization: `Bearer ${token}` } });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as { data: { task_id: string } }).data.task_id, requestId);
    const completed = await waitState(socket, requestId, "completed") as { result: { response: { text: string } } };
    assert.equal(completed.result.response.text, "HTTP owner result");
  } finally {
    if (child) await stopOwner(child, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("private owner creates, queries, aborts and reopens native tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-owner-"));
  const store = join(directory, "owner.sqlite");
  const socket = join(directory, "owner.sock");
  let child: ChildProcess | undefined;
  try {
    child = await startOwner(store, socket);
    assert.equal((await stat(store)).mode & 0o777, 0o600);
    assert.equal((await stat(socket)).mode & 0o777, 0o600);
    const taskId = randomUUID();
    const created = await request(socket, "submit", {
      requestId: taskId, input: { text: "Artifact ready.", holdMs: 0 },
    });
    assert.equal(created.success, true, created.error);
    assert.deepEqual(created.data, { task_id: taskId });
    const repeated = await request(socket, "submit", {
      requestId: taskId, input: { text: "Artifact ready.", holdMs: 0 },
    });
    assert.deepEqual(repeated.data, created.data);
    const completed = await waitState(socket, taskId, "completed") as { result: unknown; failure: null };
    assert.deepEqual(completed.result, {
      exit_code: 0,
      response: { text: "Artifact ready.", spoken: "Artifact ready.", presentation: null, resourceUri: null },
    });
    assert.equal(completed.failure, null);
    const batch = await request(socket, "get_many", { taskIds: [taskId, randomUUID()] });
    assert.equal(batch.success, true, batch.error);
    assert.equal((batch.data as Record<string, { state: string }>)[taskId].state, "completed");

    const cancelledId = randomUUID();
    await request(socket, "submit", {
      requestId: cancelledId, input: { text: "Never send", holdMs: 5_000 },
    });
    await waitState(socket, cancelledId, "running");
    const abort = await request(socket, "abort", { taskId: cancelledId });
    assert.equal(abort.success, true, abort.error);
    await waitState(socket, cancelledId, "cancelled");
    await stopOwner(child);
    child = await startOwner(store, socket);
    assert.equal((await request(socket, "get", { taskId })).data &&
      ((await request(socket, "get", { taskId })).data as { state: string }).state, "completed");
    assert.equal(((await request(socket, "get", { taskId: cancelledId })).data as { state: string }).state, "cancelled");
  } finally {
    if (child) await stopOwner(child, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("product task uses the native owner and preserves the public result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-owner-product-"));
  const store = join(directory, "owner.sqlite");
  const socket = join(directory, "owner.sock");
  const packageDir = join(directory, "voice_worker");
  await mkdir(packageDir);
  await writeFile(join(packageDir, "__init__.py"), "");
  await writeFile(join(packageDir, "native_task.py"),
    "import json,sys,time\np=json.load(sys.stdin)\n"
    + "if p['params']['instruction']=='hold': time.sleep(5)\n"
    + "json.dump({'exit_code':0,'response':{'text':p['params']['instruction'],'spoken':'done'}},sys.stdout)\n");
  let child: ChildProcess | undefined;
  try {
    child = await startOwner(store, socket, 5, {
      PI_DURABLE_TASK_PYTHON: "/usr/bin/python3", PYTHONPATH: directory,
    });
    const requestId = randomUUID();
    const input = { kind: "digital-twin-classify", requestId,
      params: { workspace: "scratch", instruction: "Write marker" } };
    const created = await request(socket, "submit", { requestId, input });
    assert.equal(created.success, true, created.error);
    const completed = await waitState(socket, requestId, "completed") as {
      result: { exit_code: number; response: { text: string } };
    };
    assert.equal(completed.result.response.text, "Write marker");
    assert.equal(completed.result.exit_code, 0);
    assert.deepEqual((await request(socket, "submit", { requestId, input })).data, created.data);
    const cancelledId = randomUUID();
    const held = await request(socket, "submit", { requestId: cancelledId,
      input: { kind: "digital-twin-classify", requestId: cancelledId,
        params: { workspace: "scratch", instruction: "hold" } } });
    assert.equal(held.success, true, held.error);
    await waitState(socket, cancelledId, "running");
    const lookupStarted = performance.now();
    const active = await request(socket, "get", { taskId: cancelledId });
    assert.equal((active.data as { state: string }).state, "running");
    assert.ok(performance.now() - lookupStarted < 1_000, "active task lookup must not await the subprocess");
    assert.equal((await request(socket, "abort", { taskId: cancelledId })).success, true);
    await waitState(socket, cancelledId, "cancelled");
    await stopOwner(child);
    child = await startOwner(store, socket, 5, {
      PI_DURABLE_TASK_PYTHON: "/usr/bin/python3", PYTHONPATH: directory,
    });
    assert.equal(((await request(socket, "get", { taskId: requestId })).data as { state: string }).state,
      "completed");
  } finally {
    if (child) await stopOwner(child, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a crashed task parks and the private retry calls native retryTask", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-owner-retry-"));
  const store = join(directory, "owner.sqlite");
  const socket = join(directory, "owner.sock");
  let child: ChildProcess | undefined;
  try {
    child = await startOwner(store, socket, 1);
    const taskId = randomUUID();
    await request(socket, "submit", { requestId: taskId, input: { text: "Recovered.", holdMs: 1_500 } });
    await waitState(socket, taskId, "running");
    await stopOwner(child, "SIGKILL");
    child = await startOwner(store, socket, 1);
    const pending = await request(socket, "get", { taskId });
    assert.equal((pending.data as { state: string }).state, "pending");
    const inspect = await request(socket, "inspect");
    assert.equal(inspect.success, true, inspect.error);
    assert.ok((inspect.data as { tasks: Array<{ state: { kind: string; reason?: string } }> }).tasks
      .some((task) => task.state.kind === "blocked" && task.state.reason === "restart_limit"));
    const retry = await request(socket, "retry", { taskId });
    assert.equal(retry.success, true, retry.error);
    const completed = await waitState(socket, taskId, "completed") as { result: { response: { text: string } } };
    assert.equal(completed.result.response.text, "Recovered.");
  } finally {
    if (child) await stopOwner(child, "SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
