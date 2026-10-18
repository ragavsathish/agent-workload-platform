import { readFile } from "node:fs/promises";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  TraceArtifactStore,
  type TraceExplainerManifest,
  type TraceRecording,
  type TraceRenderJob,
} from "./artifacts.js";

export const APP_RESOURCE_URI = "ui://playwright-trace-viewer/main.html";

async function viewerPresentation(
  recording: TraceRecording,
  publicBaseUrl: string,
  store: TraceArtifactStore,
): Promise<Record<string, unknown>> {
  const traceUrl = `${publicBaseUrl}/api/playwright-traces/${recording.id}/trace.zip`;
  const viewerUrl = `${publicBaseUrl}/trace-viewer/index.html?trace=${encodeURIComponent(traceUrl)}`;
  const details = await store.traceSummary(recording.id).catch(() => ({
    durationMs: 0,
    actionCount: 0,
    requestCount: 0,
    errorCount: 0,
    actions: [],
  }));
  return {
    kind: "playwright-trace-viewer",
    title: recording.name,
    status: "completed",
    summary: `${recording.project} · ${recording.run}`,
    traceId: recording.id,
    project: recording.project,
    run: recording.run,
    modifiedAt: recording.modifiedAt,
    viewerUrl,
    previewUrl: `${publicBaseUrl}/api/playwright-traces/${recording.id}/preview`,
    durationMs: details.durationMs,
    actionCount: details.actionCount,
    requestCount: details.requestCount,
    errorCount: details.errorCount,
    actions: details.actions,
  };
}

async function viewerResult(
  recording: TraceRecording,
  publicBaseUrl: string,
  store: TraceArtifactStore,
): Promise<CallToolResult> {
  const traceUri = `playwright-trace://recordings/${recording.id}`;
  const presentation = await viewerPresentation(recording, publicBaseUrl, store);
  return {
    content: [
      {
        type: "text",
        text: [
          `Opening Playwright trace “${recording.name}” from ${recording.project}.`,
          "Use this exact object as the final response's presentation field and add a short spoken string:",
          JSON.stringify(presentation),
        ].join("\n"),
      },
      {
        type: "resource_link",
        uri: traceUri,
        name: `${recording.name}.zip`,
        mimeType: "application/zip",
        description: "Selected Playwright trace recording",
      },
    ],
    structuredContent: { presentation },
  };
}

async function manifestResult(
  manifest: TraceExplainerManifest,
  publicBaseUrl: string,
  store: TraceArtifactStore,
): Promise<CallToolResult> {
  const presentation = {
    ...await viewerPresentation(await store.recording(manifest.traceId), publicBaseUrl, store),
    narratedVideoUrl: `${publicBaseUrl}${manifest.videoUri}`,
    narratedDurationSeconds: manifest.durationSeconds,
    narratedSceneCount: manifest.scenes.length,
    narratedSummary: manifest.summary,
  };
  return {
    content: [
      {
        type: "text",
        text: [
          `Narrated trace explainer ready: ${manifest.title} (${manifest.scenes.length} scenes).`,
          "Keep the Trace Viewer presentation visible and use this exact updated presentation in the final response:",
          JSON.stringify(presentation),
        ].join("\n"),
      },
      {
        type: "resource_link",
        uri: manifest.videoResourceUri,
        name: `${manifest.title}.mp4`,
        mimeType: "video/mp4",
        description: "Narrated Playwright trace explainer",
      },
    ],
    structuredContent: { presentation },
  };
}

function pendingJobResult(job: TraceRenderJob): CallToolResult {
  return {
    content: [{
      type: "text",
      text: `Narrated trace render ${job.renderId} is ${job.status}. Check it with get_trace_explainer.`,
    }],
    structuredContent: { render: job },
    ...(job.status === "failed" ? { isError: true } : {}),
  };
}

async function jobResult(
  job: TraceRenderJob,
  publicBaseUrl: string,
  store: TraceArtifactStore,
): Promise<CallToolResult> {
  if (job.status !== "completed") return pendingJobResult(job);
  return manifestResult(await store.readManifest(job.renderId, job.traceId), publicBaseUrl, store);
}

export function createServer(
  store: TraceArtifactStore,
  appHtmlPath: string,
  publicBaseUrl = "http://127.0.0.1:9450",
): McpServer {
  const server = new McpServer({ name: "Playwright Trace Viewer", version: "0.2.0" });

  server.registerTool(
    "search_playwright_traces",
    {
      title: "Search Playwright traces",
      description: [
        "Search available Playwright recordings before rendering a trace viewer.",
        "Use the user's test, project, run, failure, and recency clues to choose the best opaque trace ID.",
        "If several results remain equally plausible, ask the user to disambiguate instead of guessing.",
      ].join(" "),
      inputSchema: z.object({
        query: z.string().max(500).default(""),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }): Promise<CallToolResult> => {
      const recordings = await store.search(query, limit);
      return {
        content: [{
          type: "text",
          text: recordings.length
            ? recordings.map(({ id, name, project, run, modifiedAt }) => (
              `${id} | ${name} | project=${project} | run=${run} | modified=${modifiedAt}`
            )).join("\n")
            : `No Playwright traces matched “${query}”.`,
        }],
        structuredContent: { query, recordings },
      };
    },
  );

  registerAppTool(
    server,
    "render_playwright_trace",
    {
      title: "Render Playwright trace viewer",
      description: [
        "Render one Playwright recording in the official Trace Viewer UI.",
        "Call search_playwright_traces first and pass only the selected opaque traceId.",
        "This tool does not choose between traces.",
      ].join(" "),
      inputSchema: z.object({ traceId: z.string().regex(/^[a-f0-9]{32}$/u) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ traceId }): Promise<CallToolResult> => {
      try {
        await store.tracePath(traceId);
        return await viewerResult(await store.recording(traceId), publicBaseUrl, store);
      } catch (error) {
        console.error("[playwright-trace-viewer] render failed", error);
        return {
          content: [{ type: "text", text: "The selected Playwright trace is unavailable." }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "render_narrated_trace_export",
    {
      title: "Export narrated Playwright trace video",
      description: "Create an optional narrated MP4 only when the user explicitly asks for a video export.",
      inputSchema: z.object({
        traceId: z.string().regex(/^[a-f0-9]{32}$/u),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ traceId }): Promise<CallToolResult> => {
      try {
        return pendingJobResult(await store.enqueue(traceId));
      } catch (error) {
        console.error("[trace-explainer] render failed", error);
        return {
          content: [{
            type: "text",
            text: "Trace explainer render failed. Check the server log for details.",
          }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_trace_explainer",
    {
      title: "Get narrated trace explainer",
      description: "Returns a completed trace explainer manifest and video resource.",
      inputSchema: z.object({
        renderId: z.string().regex(/^[a-f0-9]{32}$/u),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ renderId }): Promise<CallToolResult> => {
      try {
        return await jobResult(await store.readJob(renderId), publicBaseUrl, store);
      } catch (error) {
        console.error("[trace-explainer] read failed", error);
        return {
          content: [{
            type: "text",
            text: "Trace explainer is unavailable.",
          }],
          isError: true,
        };
      }
    },
  );

  registerAppResource(
    server,
    APP_RESOURCE_URI,
    APP_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(appHtmlPath, "utf8"),
        _meta: {
          ui: {
            prefersBorder: false,
          },
        },
      }],
    }),
  );

  server.registerResource(
    "playwright-trace-recording",
    new ResourceTemplate("playwright-trace://recordings/{traceId}", { list: undefined }),
    { mimeType: "application/zip" },
    async (_uri, variables): Promise<ReadResourceResult> => {
      const traceId = String(variables.traceId ?? "");
      return {
        contents: [{
          uri: `playwright-trace://recordings/${traceId}`,
          mimeType: "application/zip",
          blob: (await readFile(await store.tracePath(traceId))).toString("base64"),
        }],
      };
    },
  );

  server.registerResource(
    "trace-explainer-video",
    new ResourceTemplate("trace-explainer://renders/{renderId}/video", { list: undefined }),
    { mimeType: "video/mp4" },
    async (_uri, variables): Promise<ReadResourceResult> => {
      const renderId = String(variables.renderId ?? "");
      return {
        contents: [{
          uri: `trace-explainer://renders/${renderId}/video`,
          mimeType: "video/mp4",
          blob: Buffer.from(await store.readVideo(renderId)).toString("base64"),
        }],
      };
    },
  );

  return server;
}
