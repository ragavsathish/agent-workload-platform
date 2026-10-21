import assert from "node:assert/strict";
import test from "node:test";

import { createGondolinBashOperations } from "./dist/gondolin-operations.js";

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
