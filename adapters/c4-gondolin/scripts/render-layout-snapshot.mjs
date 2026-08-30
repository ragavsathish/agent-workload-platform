#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { preview } from "vite";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/render-layout-snapshot.mjs INPUT.mmd OUTPUT.json");
  process.exit(2);
}

const adapterDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const invocationDir = process.env.INIT_CWD ?? process.cwd();
const resolveArgument = (value) => path.resolve(invocationDir, value);
const definition = await readFile(resolveArgument(inputPath), "utf8");
const server = await preview({
  configFile: false,
  root: adapterDir,
  build: { outDir: path.join(adapterDir, "dist", "browser") },
  logLevel: "error",
  preview: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
});

let browser;
try {
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not expose a local TCP address");
  const executablePath = process.env.MERMAID_EXCALIDRAW_BROWSER_PATH;
  const channel = process.env.MERMAID_EXCALIDRAW_BROWSER_CHANNEL;
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : channel === "bundled" ? {} : { channel: channel || "chrome" }),
  });
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`browser console: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.error(`browser page: ${error.message}`));
  page.on("requestfailed", (request) =>
    console.error(`browser request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`)
  );
  page.setDefaultTimeout(60_000);
  await page.goto(`http://127.0.0.1:${address.port}/converter.html`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.mermaidToLayoutSnapshot === "function",
    undefined,
    { timeout: 60_000 },
  );
  const snapshot = await page.evaluate(
    async (source) => window.mermaidToLayoutSnapshot(source),
    definition,
  );
  await writeFile(resolveArgument(outputPath), `${JSON.stringify(snapshot, null, 2)}\n`);
} finally {
  await browser?.close();
  await server.close();
}
