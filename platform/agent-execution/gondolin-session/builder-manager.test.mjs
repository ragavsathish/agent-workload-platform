import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDER_LABEL,
  DEFAULT_BUILDER_DISK,
  createBuilderServiceAccess,
  runnerRegistrationCommand,
} from "./dist/builder-manager.js";

test("the shared builder routes only its synthetic Gitea name to host loopback", async () => {
  const access = createBuilderServiceAccess("http://127.0.0.1:3001");
  const gitea = await access.httpHooks.onRequest(
    new Request("http://gitea.local:3001/api/v1/version"),
  );
  assert.equal(gitea.url, "http://127.0.0.1:3001/api/v1/version");

  const loopback = await access.httpHooks.onRequest(
    new Request("http://127.0.0.1:3001/api/v1/version"),
  );
  assert.equal(loopback.status, 403);

  const challenge = await access.httpHooks.onResponse(
    new Response(null, {
      status: 401,
      headers: {
        "www-authenticate": 'Bearer realm="http://127.0.0.1:3001/v2/token",service="container_registry"',
      },
    }),
    new Request("http://127.0.0.1:3001/v2/"),
  );
  assert.equal(
    challenge.headers.get("www-authenticate"),
    'Bearer realm="http://gitea.local:3001/v2/token",service="container_registry"',
  );
});

test("the runner is non-interactive, shared, and host-executed inside the VM", () => {
  const command = runnerRegistrationCommand();
  assert.equal(BUILDER_LABEL, "gondolin-builder:host");
  assert.deepEqual(command.slice(0, 3), ["/usr/local/bin/gitea-runner", "register", "--no-interactive"]);
  assert.ok(command.includes("http://gitea.local:3001"));
  assert.ok(!command.some((argument) => argument.includes("secret")));
  assert.ok(command.includes(BUILDER_LABEL));
  assert.equal(DEFAULT_BUILDER_DISK, "128G");
});
