import assert from "node:assert/strict";
import test from "node:test";

import { parseDockerSystemDf, parseHumanBytes, storageRecords } from "./storage-collector.mjs";

test("parses Docker's decimal sizes and reclaimable percentages", () => {
  assert.equal(parseHumanBytes("1.2GB"), 1_200_000_000);
  assert.equal(parseHumanBytes("19.03GB (100%)"), 19_030_000_000);
  assert.equal(parseHumanBytes("0B"), 0);
  const usage = parseDockerSystemDf([
    '{"Type":"Images","Size":"67.3GB","Reclaimable":"54.61GB (81%)"}',
    '{"Type":"Build Cache","Size":"19.03GB","Reclaimable":"19.03GB"}',
  ].join("\n"));
  assert.deepEqual(usage.get("images"), { size: 67_300_000_000, reclaimable: 54_610_000_000 });
  assert.deepEqual(usage.get("build_cache"), { size: 19_030_000_000, reclaimable: 19_030_000_000 });
});

test("emits bounded storage records", () => {
  const output = storageRecords(
    new Map([["image_handoff", 1_200_000_000]]),
    new Map([["build_cache", { size: 19_000_000_000, reclaimable: 19_000_000_000 }]]),
  );
  assert.deepEqual(output, [
    { metric: "directory", area: "image_handoff", bytes: 1_200_000_000 },
    { metric: "docker_size", kind: "build_cache", bytes: 19_000_000_000 },
    { metric: "docker_reclaimable", kind: "build_cache", bytes: 19_000_000_000 },
  ]);
});
