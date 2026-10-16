import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHostSafeConfig,
  localCacheReference,
} from "./dist/image-installer.js";

test("OCI digests map to stable local Gondolin cache references", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  assert.equal(localCacheReference(digest), `oci-cache:${"a".repeat(32)}`);
  assert.throws(() => localCacheReference("sha256:short"), /invalid OCI digest/);
});

test("host conversion rejects repository-controlled host integration", () => {
  const safe = {
    arch: "aarch64",
    distro: "alpine",
    alpine: { version: "3.23.0" },
    oci: { image: "ignored:latest" },
  };
  assert.doesNotThrow(() => assertHostSafeConfig(safe));
  assert.throws(
    () => assertHostSafeConfig({ ...safe, postBuild: { commands: ["touch /host"] } }),
    /does not allow init or postBuild/,
  );
  assert.throws(
    () => assertHostSafeConfig({ ...safe, alpine: { version: "3.23.0", mirror: "http://localhost" } }),
    /custom Alpine mirror/,
  );
});
