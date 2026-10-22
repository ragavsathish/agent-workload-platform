import assert from "node:assert/strict";
import test from "node:test";

import { createGondolinBashOperations, createGondolinCodingTools } from "./dist/gondolin-operations.js";

test("guest bash preserves the image environment instead of starting a login shell", async () => {
  let invoked;
  const vm = {
    exec(command, options) {
      invoked = { command, options };
      const process = Promise.resolve({ exitCode: 0 });
      process.output = async function* output() {};
      return process;
    },
  };

  const operations = createGondolinBashOperations(vm, "/host/repository");
  const result = await operations.exec("command -v flutter", "/host/repository", {
    onData() {},
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(invoked.command, ["/bin/bash", "-c", "command -v flutter"]);
  assert.equal(invoked.options.cwd, "/workspace");
});

test("Pi coding tools translate the host workspace into the guest mount", async () => {
  const hostWorkspace = "/host/voice-workspace";
  const invoked = [];
  const vm = {
    exec(command, options) {
      invoked.push({ kind: "exec", command, path: options.cwd });
      const process = Promise.resolve({ exitCode: options.cwd === "/workspace" ? 0 : 127 });
      process.output = async function* output() {
        if (options.cwd === "/workspace") yield { data: Buffer.from("tool-ok\n") };
      };
      return process;
    },
    fs: {
      access: async (path) => { invoked.push({ kind: "access", path }); },
      readFile: async (path) => {
        invoked.push({ kind: "read", path });
        return Buffer.from("file-ok\n");
      },
      mkdir: async (path) => { invoked.push({ kind: "mkdir", path }); },
      writeFile: async (path) => { invoked.push({ kind: "write", path }); },
    },
  };
  const tools = createGondolinCodingTools(vm, hostWorkspace);
  const context = { cwd: hostWorkspace };

  const bash = await tools.find((tool) => tool.name === "bash").execute(
    "bash-call", { command: "echo tool-ok" }, undefined, undefined, context,
  );
  assert.notEqual(bash.isError, true);
  assert.deepEqual(invoked.find((entry) => entry.kind === "exec")?.path, "/workspace");

  await tools.find((tool) => tool.name === "read").execute(
    "read-call", { path: "README.md" }, undefined, undefined, context,
  );
  assert.deepEqual(invoked.find((entry) => entry.kind === "read")?.path, "/workspace/README.md");

  await tools.find((tool) => tool.name === "write").execute(
    "write-call", { path: "notes.txt", content: "ok" }, undefined, undefined, context,
  );
  assert.deepEqual(invoked.find((entry) => entry.kind === "write")?.path, "/workspace/notes.txt");
});
