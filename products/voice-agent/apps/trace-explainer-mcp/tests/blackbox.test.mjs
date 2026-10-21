import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium } from "playwright";

const serverEntry = resolve("dist/main.js");

async function availablePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No TCP port"));
      server.close(() => resolvePort(address.port));
    });
  });
}

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Trace Viewer MCP did not become healthy");
}

async function listen(server, port) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

test("agent-facing search selects a trace and the real Playwright viewer renders it", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "playwright-trace-viewer-blackbox-"));
  const artifacts = join(temporary, "artifacts");
  const traceDirectory = join(
    artifacts,
    "20261017T120000Z",
    "results",
    "voice",
    "tests-test-blackbox--abc123--trace-viewer",
  );
  const output = join(temporary, "output");
  await mkdir(traceDirectory, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const recordingContext = await browser.newContext();
  await recordingContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const recordingPage = await recordingContext.newPage();
  await recordingPage.goto("data:text/html,<title>Blackbox trace fixture</title><button id='ready'>Ready</button>");
  await recordingPage.locator("#ready").click();
  await recordingContext.tracing.stop({ path: join(traceDirectory, "trace.zip") });
  await recordingContext.close();
  const distractorDirectory = join(
    artifacts,
    "20261016T120000Z",
    "results",
    "diagnostics",
    "tests-unrelated-login",
  );
  await mkdir(distractorDirectory, { recursive: true });
  await copyFile(join(traceDirectory, "trace.zip"), join(distractorDirectory, "trace.zip"));

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [serverEntry], {
    cwd: resolve("."),
    env: {
      ...process.env,
      PLAYWRIGHT_TRACE_ARTIFACT_ROOT: artifacts,
      PLAYWRIGHT_TRACE_OUTPUT_ROOT: output,
      PLAYWRIGHT_TRACE_RENDERER: resolve("../client/tool/prototype-trace-explainer.mjs"),
      PLAYWRIGHT_TRACE_MCP_HOST: "127.0.0.1",
      PLAYWRIGHT_TRACE_MCP_PORT: String(port),
      PLAYWRIGHT_TRACE_VIEWER_BASE_URL: baseUrl,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverError = "";
  let appHost;
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => { serverError += chunk; });

  const client = new Client({ name: "blackbox-agent", version: "1.0.0" });
  try {
    await waitForHealth(baseUrl);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));

    const search = await client.callTool({
      name: "search_playwright_traces",
      arguments: { query: "voice blackbox trace viewer", limit: 5 },
    });
    assert.equal(search.isError, undefined);
    assert.equal(search.structuredContent.recordings.length, 1);
    assert.equal(search.structuredContent.recordings[0].project, "voice");

    const traceId = search.structuredContent.recordings[0].id;
    const rendered = await client.callTool({
      name: "render_playwright_trace",
      arguments: { traceId },
    });
    assert.equal(rendered.isError, undefined);
    assert.equal(rendered.structuredContent.presentation.traceId, traceId);

    const viewerPage = await browser.newPage();
    await viewerPage.goto(rendered.structuredContent.presentation.viewerUrl);
    await assert.doesNotReject(async () => {
      await viewerPage.getByText("Blackbox trace fixture", { exact: false }).first().waitFor({ timeout: 15_000 });
    });
    const viewerText = await viewerPage.locator("body").innerText();
    assert.match(viewerText, /click/iu);
    await viewerPage.close();

    const appResource = await client.readResource({ uri: "ui://playwright-trace-viewer/main.html" });
    const appHtml = appResource.contents[0].text;
    assert.equal(typeof appHtml, "string");
    const appPort = await availablePort();
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const presentation = {
      ...rendered.structuredContent.presentation,
      viewerUrl: `http://127.0.0.1:9450/trace-viewer/index.html?trace=${encodeURIComponent(
        `http://127.0.0.1:9450/api/playwright-traces/${traceId}/trace.zip`,
      )}`,
      previewUrl: `http://127.0.0.1:9450/api/playwright-traces/${traceId}/preview`,
    };
    appHost = createHttpServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", appOrigin);
      if (requestUrl.pathname === "/app.html") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(appHtml);
        return;
      }
      if (requestUrl.pathname.startsWith("/trace-viewer/")
        || requestUrl.pathname.startsWith("/api/playwright-traces/")) {
        const upstream = await fetch(`${baseUrl}${requestUrl.pathname}${requestUrl.search}`, {
          headers: request.headers.range ? { Range: request.headers.range } : {},
        });
        response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
        if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
        else response.end();
        return;
      }
      if (requestUrl.pathname === "/") {
        const encodedPresentation = JSON.stringify(presentation).replaceAll("<", "\\u003c");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html><body style="margin:0">
          <iframe id="app-frame" title="Blackbox MCP App" src="/app.html"
            sandbox="allow-scripts" style="width:100vw;height:100vh;border:0"></iframe>
          <script>
            const presentation = ${encodedPresentation};
            const frame = document.querySelector('#app-frame');
            addEventListener('message', (event) => {
              if (event.source !== frame.contentWindow || !event.data) return;
              const message = event.data;
              const send = (payload) => frame.contentWindow.postMessage(payload, '*');
              if (message.method === 'ui/initialize') {
                send({ jsonrpc: '2.0', id: message.id, result: {
                  protocolVersion: '2025-11-21',
                  hostInfo: { name: 'blackbox-host', version: '1.0.0' },
                  hostCapabilities: { openLinks: {}, updateModelContext: { text: {}, structuredContent: {} }, message: { text: {} } },
                  hostContext: { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], platform: 'web' },
                }});
              } else if (message.method === 'ui/notifications/initialized') {
                send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: presentation } });
                send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: { presentation } } });
              } else if (message.method === 'ui/open-link') {
                window.open(message.params.url, '_blank');
                send({ jsonrpc: '2.0', id: message.id, result: {} });
              } else if (message.id !== undefined) {
                const result = message.method === 'ui/request-display-mode' ? { mode: 'inline' } : {};
                send({ jsonrpc: '2.0', id: message.id, result });
              }
            });
          </script>
        </body></html>`);
        return;
      }
      response.writeHead(404).end();
    });
    await listen(appHost, appPort);

    const appPage = await browser.newPage();
    const diagnostics = [];
    appPage.on("console", (message) => diagnostics.push(`console:${message.type()}:${message.text()}`));
    appPage.on("pageerror", (error) => diagnostics.push(`pageerror:${error.message}`));
    appPage.on("requestfailed", (request) => {
      diagnostics.push(`request:${request.url()}:${request.failure()?.errorText ?? "failed"}`);
    });
    appPage.on("response", (browserResponse) => {
      if (browserResponse.status() >= 400) {
        diagnostics.push(`response:${browserResponse.status()}:${browserResponse.url()}`);
      } else if (browserResponse.url().includes("/trace-viewer/") && diagnostics.length < 30) {
        void browserResponse.allHeaders().then((headers) => {
          diagnostics.push(`headers:${browserResponse.url()}:${JSON.stringify(headers)}`);
        });
      }
    });
    await appPage.goto(appOrigin);
    const appFrame = appPage.frameLocator("#app-frame");
    try {
      await appFrame.locator('#app[data-ready="true"]').waitFor({ timeout: 15_000 });
    } catch (error) {
      const frameBody = await appFrame.locator("body").innerText().catch(() => "<unavailable>");
      throw new Error(`${error.message}\nframe=${frameBody}\n${diagnostics.join(" | ")}`);
    }
    await appFrame.getByText("Explain the failure", { exact: true }).waitFor();
    const popupPromise = appPage.waitForEvent("popup");
    await appFrame.getByText("Open Trace Viewer", { exact: true }).click();
    const appViewerPage = await popupPromise;
    await appViewerPage.getByText("Blackbox trace fixture", { exact: false }).first()
      .waitFor({ timeout: 15_000 });
    assert.match(await appViewerPage.locator("body").innerText(), /click/iu, diagnostics.join(" | "));
    await appViewerPage.close();
    await appPage.close();
  } finally {
    await client.close().catch(() => {});
    if (appHost) await new Promise((resolveClose) => appHost.close(resolveClose));
    server.kill("SIGTERM");
    await new Promise((resolvePromise) => server.once("exit", resolvePromise));
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
  assert.equal(serverError.includes("EADDRINUSE"), false, serverError);
});
