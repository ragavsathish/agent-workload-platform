#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Request, Response } from "express";

import { createServer } from "./server.js";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const appHtml = resolve(
  process.env.JOURNAL_REVIEW_APP_HTML ?? resolve(distributionRoot, "app/main.html"),
);
const host = process.env.JOURNAL_REVIEW_MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.JOURNAL_REVIEW_MCP_PORT ?? "9460");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid server port");
const allowedHosts = [
  host,
  "127.0.0.1",
  "localhost",
  "::1",
  "host.docker.internal",
  ...(process.env.JOURNAL_REVIEW_MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
];

async function startStdio(): Promise<void> {
  await createServer(appHtml).connect(new StdioServerTransport());
}

async function startHttp(): Promise<void> {
  const app = createMcpExpressApp({ host, allowedHosts });
  app.get("/api/health", (_request: Request, response: Response) => {
    response.json({ status: "ok", app: "journal-review" });
  });
  app.all("/mcp", async (request: Request, response: Response) => {
    const server = createServer(appHtml);
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
    console.error(`Journal Review MCP listening on http://${host}:${port}/mcp`);
  });
}

if (process.argv.includes("--stdio")) await startStdio();
else await startHttp();
