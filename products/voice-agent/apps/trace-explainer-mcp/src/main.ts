#!/usr/bin/env node

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";
import express from "express";

import { HttpTraceRenderBackend, processRenderer, TraceArtifactStore } from "./artifacts.js";
import { createServer } from "./server.js";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(distributionRoot, "..");
const require = createRequire(import.meta.url);
const playwrightRoot = dirname(require.resolve("playwright-core/package.json"));
const traceViewerAssets = resolve(playwrightRoot, "lib/vite/traceViewer");
const voiceApps = resolve(packageRoot, "..");
const artifactRoot = resolve(
  process.env.PLAYWRIGHT_TRACE_ARTIFACT_ROOT
    ?? process.env.TRACE_EXPLAINER_ARTIFACT_ROOT
    ?? resolve(voiceApps, "client/build"),
);
const outputRoot = resolve(
  process.env.PLAYWRIGHT_TRACE_OUTPUT_ROOT
    ?? process.env.TRACE_EXPLAINER_OUTPUT_ROOT
    ?? resolve(voiceApps, "client/build/trace-explainer-renders"),
);
const rendererScript = resolve(
  process.env.PLAYWRIGHT_TRACE_RENDERER
    ?? process.env.TRACE_EXPLAINER_RENDERER
    ?? resolve(voiceApps, "client/tool/prototype-trace-explainer.mjs"),
);
const appHtml = resolve(
  process.env.TRACE_EXPLAINER_APP_HTML ?? resolve(distributionRoot, "app/main.html"),
);
const remoteRenderWorker = process.env.TRACE_RENDER_WORKER_URL
  ? new HttpTraceRenderBackend(process.env.TRACE_RENDER_WORKER_URL)
  : undefined;
if (process.env.TRACE_RENDER_REQUIRE_REMOTE === "true" && !remoteRenderWorker) {
  throw new Error("TRACE_RENDER_WORKER_URL is required; direct host rendering is disabled");
}
const store = new TraceArtifactStore(
  artifactRoot,
  outputRoot,
  processRenderer(rendererScript),
  remoteRenderWorker,
);
const host = process.env.PLAYWRIGHT_TRACE_MCP_HOST
  ?? process.env.TRACE_EXPLAINER_HOST
  ?? "127.0.0.1";
const port = Number(
  process.env.PLAYWRIGHT_TRACE_MCP_PORT
    ?? process.env.TRACE_EXPLAINER_PORT
    ?? "9450",
);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid server port");
const publicBaseUrl = (
  process.env.PLAYWRIGHT_TRACE_VIEWER_BASE_URL
    ?? process.env.TRACE_VIEWER_PUBLIC_BASE_URL
    ?? `http://${host}:${port}`
).replace(/\/$/u, "");
const localBaseUrl = `http://${host}:${port}`;
const factory = () => createServer(store, appHtml, publicBaseUrl);
const allowedHosts = [
  host,
  "127.0.0.1",
  "localhost",
  "::1",
  "host.docker.internal",
  ...(process.env.PLAYWRIGHT_TRACE_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];

function configureViewerRoutes(app: ReturnType<typeof createMcpExpressApp>): void {
  app.use("/trace-viewer", express.static(traceViewerAssets, {
    fallthrough: false,
    immutable: true,
    maxAge: "1h",
  }));

  app.get("/api/playwright-traces/:traceId/trace.zip", async (request: Request, response: Response) => {
    try {
      const traceId = Array.isArray(request.params.traceId)
        ? request.params.traceId[0]
        : request.params.traceId;
      const path = await store.tracePath(traceId);
      response.set({
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "Content-Type": "application/zip",
        "X-Content-Type-Options": "nosniff",
      });
      response.sendFile(path);
    } catch {
      response.status(404).json({ error: "Playwright trace not found" });
    }
  });

  app.get("/api/playwright-traces/:traceId/preview", async (request: Request, response: Response) => {
    try {
      const traceId = Array.isArray(request.params.traceId)
        ? request.params.traceId[0]
        : request.params.traceId;
      const preview = await store.tracePreview(traceId);
      response.set({
        "Cache-Control": "private, no-store",
        "Content-Type": preview.mimeType,
        "X-Content-Type-Options": "nosniff",
      });
      response.send(Buffer.from(preview.bytes));
    } catch {
      response.status(404).json({ error: "Playwright trace preview not found" });
    }
  });

  app.get("/api/health", (_request: Request, response: Response) => {
    response.json({ status: "ok", viewer: "playwright" });
  });

  app.post(
    "/api/trace-explainers",
    express.json({ limit: "8kb" }),
    async (request: Request, response: Response) => {
      const traceId = typeof request.body?.traceId === "string" ? request.body.traceId : "";
      if (!/^[a-f0-9]{32}$/u.test(traceId)) {
        return response.status(400).json({ error: "invalid Playwright trace ID" });
      }
      try {
        const job = await store.enqueue(traceId);
        return response.status(202).json(job);
      } catch {
        return response.status(404).json({ error: "Playwright trace not found" });
      }
    },
  );

  app.get("/api/trace-explainers/:renderId", async (request: Request, response: Response) => {
    const renderId = Array.isArray(request.params.renderId)
      ? request.params.renderId[0]
      : request.params.renderId;
    if (!/^[a-f0-9]{32}$/u.test(renderId)) {
      return response.status(400).json({ error: "invalid trace render ID" });
    }
    try {
      const job = await store.readJob(renderId);
      return response.json({
        ...job,
        ...(job.status === "completed"
          ? { videoUrl: `${publicBaseUrl}/api/trace-explainers/${renderId}/video` }
          : {}),
      });
    } catch {
      return response.status(404).json({ error: "trace render not found" });
    }
  });
}

async function startStdio(): Promise<void> {
  const app = createMcpExpressApp({ host, allowedHosts });
  configureViewerRoutes(app);
  await new Promise<void>((resolvePromise, reject) => {
    const listener = app.listen(port, host, () => {
      console.error(`Playwright Trace Viewer assets listening on ${publicBaseUrl}`);
      resolvePromise();
    });
    listener.once("error", async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EADDRINUSE") return reject(error);
      try {
        const response = await fetch(`${localBaseUrl}/api/health`);
        if (!response.ok) throw new Error("Existing trace viewer endpoint is unhealthy");
        console.error(`Reusing Playwright Trace Viewer assets at ${publicBaseUrl}`);
        resolvePromise();
      } catch (healthError) {
        reject(healthError);
      }
    });
  });
  await factory().connect(new StdioServerTransport());
}

async function startHttp(): Promise<void> {
  const app = createMcpExpressApp({ host, allowedHosts });
  configureViewerRoutes(app);

  app.get("/api/trace-explainers/:renderId/video", async (request: Request, response: Response) => {
    try {
      const renderId = Array.isArray(request.params.renderId)
        ? request.params.renderId[0]
        : request.params.renderId;
      const video = await store.readVideo(renderId);
      response.set({
        "Cache-Control": "private, no-store",
        "Content-Type": "video/mp4",
        "X-Content-Type-Options": "nosniff",
      });
      response.send(Buffer.from(video));
    } catch {
      response.status(404).json({ error: "trace explainer video not found" });
    }
  });

  app.all("/mcp", async (request: Request, response: Response) => {
    const server = factory();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: "MCP request failed" });
      console.error(error);
    }
  });

  app.listen(port, host, () => {
    console.error(`Playwright Trace Viewer MCP listening on ${publicBaseUrl}/mcp`);
  });
}

await store.recover();
if (process.argv.includes("--stdio")) await startStdio();
else await startHttp();
