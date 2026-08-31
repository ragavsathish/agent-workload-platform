import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GondolinPlaywrightMcp } from "./dist/client.js";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const architecture = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "unsupported";
const imagePath = path.resolve(
  process.env.GONDOLIN_BROWSER_ASSETS
    ?? path.join(runtimeDir, "..", "..", "artifacts", "gondolin-browser", architecture),
);
const browser = new GondolinPlaywrightMcp({ imagePath, allowedHosts: [] });

try {
  const { tools } = await browser.listTools();
  const navigate = tools.find((tool) => tool.name === "browser_navigate");
  assert(navigate, "Playwright MCP did not expose browser_navigate");
  assert.equal(navigate.inputSchema.type, "object");

  const result = await browser.callTool("browser_navigate", {
    url: "data:text/html,<title>Gondolin MCP smoke</title><h1>ok</h1>",
  });
  assert.equal(result.isError, undefined);
  assert(result.content.some((entry) => entry.type === "text" && entry.text.includes("Gondolin MCP smoke")));
  console.log(`Playwright MCP in Gondolin: ${tools.length} tools; navigation passed`);
} finally {
  await browser.close();
}
