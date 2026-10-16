import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGondolinCodingTools } from "./dist/coding-tools.js";
import { resolveProjectRuntime } from "./dist/pi-extension.js";

test("task Pi uses the standard coding-tool surface inside Gondolin", () => {
  const tools = createGondolinCodingTools({ fs: {} }, "/host/workspace");
  assert.deepEqual(tools.map((tool) => tool.name), ["read", "bash", "edit", "write"]);
});

test("project config selects the task image and trusted host skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gondolin-project-"));
  const project = path.join(root, "workspace");
  const skills = path.join(root, "skills");
  await mkdir(path.join(project, ".pi"), { recursive: true });
  await mkdir(skills);
  await writeFile(path.join(project, ".pi", "gondolin.json"), JSON.stringify({
    image: "full-wasm-server-build:latest",
    memory: "8G",
    cpus: 4,
    policy: ".pi/gondolin-policy.json",
  }));
  await writeFile(path.join(project, ".pi", "gondolin-policy.json"), JSON.stringify({
    network: { enabled: true, allowedHosts: ["github.com"], allowWebSockets: false },
  }));

  assert.deepEqual(resolveProjectRuntime({
    projectDirectory: project,
    fallbackImagePath: "/generic/image",
    skillsDirectory: skills,
    fallbackPublicInternet: true,
  }), {
    imagePath: "full-wasm-server-build:latest",
    memory: "8G",
    cpus: 4,
    networkEnabled: true,
    allowedHosts: ["github.com"],
    skillsDirectory: skills,
  });
});

test("workspace without config uses the generic task image", async () => {
  const project = await mkdtemp(path.join(tmpdir(), "gondolin-project-"));
  assert.deepEqual(resolveProjectRuntime({
    projectDirectory: project,
    fallbackImagePath: "/generic/image",
    fallbackPublicInternet: false,
  }), {
    imagePath: "/generic/image",
    memory: undefined,
    cpus: undefined,
    networkEnabled: false,
    allowedHosts: [],
    skillsDirectory: undefined,
  });
});
