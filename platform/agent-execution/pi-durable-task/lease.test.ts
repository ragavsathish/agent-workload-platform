import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { acquireStoreOwner } from "./lease.js";

test("store ownership is private and a stale owner can be reclaimed", async () => {
  const directory = await mkdtemp("/tmp/pi-durable-lease-");
  const storage = join(directory, "session.sqlite");
  const lock = `${storage}.owner`;
  try {
    await mkdir(lock, { mode: 0o700 });
    await writeFile(join(lock, "pid"), "999999999");
    const release = await acquireStoreOwner(storage);
    assert.equal(await readFile(join(lock, "pid"), "utf8"), String(process.pid));
    await release();
    await assert.rejects(readFile(join(lock, "pid"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
