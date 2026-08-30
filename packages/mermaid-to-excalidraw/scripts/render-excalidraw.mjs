#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { createServer } from "vite";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: node scripts/render-excalidraw.mjs INPUT.excalidraw OUTPUT.png");
  process.exit(2);
}

const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const scene = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
const server = await createServer({
  root: repoDir,
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Vite did not expose a local TCP address");
  const executablePath = process.env.MERMAID_EXCALIDRAW_BROWSER_PATH;
  const channel = process.env.MERMAID_EXCALIDRAW_BROWSER_CHANNEL;
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : channel === "bundled" ? {} : { channel: channel || "chrome" }),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(`http://127.0.0.1:${address.port}/scripts/converter.html`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => typeof window.excalidrawSceneToPng === "function",
    undefined,
    { timeout: 60_000 },
  );
  const pngBase64 = await page.evaluate(async (input) => window.excalidrawSceneToPng(input), scene);
  await writeFile(path.resolve(outputPath), Buffer.from(pngBase64, "base64"));
} finally {
  await browser?.close();
  await server.close();
}
