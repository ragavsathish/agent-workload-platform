import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GondolinPlaywrightMcp } from "./client.js";

type PiContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type PiExtensionApi = {
  on(
    event: "session_start",
    handler: (
      event: unknown,
      context: { ui: { notify(message: string, level: "info" | "error"): void } },
    ) => void | Promise<void>,
  ): void;
  on(event: "session_shutdown", handler: () => void | Promise<void>): void;
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    parameters: Record<string, unknown>;
    execute(
      toolCallId: string,
      params: Record<string, unknown>,
    ): Promise<{ content: PiContent[]; details: Record<string, string> }>;
  }): void;
};

const extensionDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(extensionDir, "..", "..");
const architecture = os.arch() === "arm64" ? "aarch64" : os.arch() === "x64" ? "x86_64" : "unsupported";
const imagePath = path.resolve(
  process.env.GONDOLIN_BROWSER_ASSETS
    ?? path.join(repositoryRoot, "artifacts", "gondolin-browser", architecture),
);

function piContent(content: unknown): PiContent[] {
  if (!Array.isArray(content)) return [{ type: "text", text: JSON.stringify(content) }];
  return content.map((item) => {
    if (item && typeof item === "object" && "type" in item) {
      if (item.type === "text" && "text" in item && typeof item.text === "string") {
        return { type: "text" as const, text: item.text };
      }
      if (
        item.type === "image"
        && "data" in item
        && typeof item.data === "string"
        && "mimeType" in item
        && typeof item.mimeType === "string"
      ) {
        return { type: "image" as const, data: item.data, mimeType: item.mimeType };
      }
    }
    return { type: "text" as const, text: JSON.stringify(item) };
  });
}

export default function gondolinBrowserExtension(pi: PiExtensionApi) {
  let browser: GondolinPlaywrightMcp | undefined;

  pi.on("session_start", async (_event, context) => {
    try {
      browser = new GondolinPlaywrightMcp({ imagePath });
      const { tools } = await browser.listTools();
      for (const tool of tools) {
        pi.registerTool({
          name: tool.name,
          label: tool.title ?? tool.annotations?.title ?? tool.name,
          description: tool.description ?? tool.name,
          promptSnippet: tool.description,
          parameters: tool.inputSchema,
          async execute(_toolCallId, params) {
            const result = await browser!.callTool(tool.name, params as Record<string, unknown>);
            return {
              content: piContent(result.content),
              details: { mcpServer: "playwright", tool: tool.name },
            };
          },
        });
      }
      context.ui.notify(`Loaded ${tools.length} Playwright MCP tools in Gondolin`, "info");
    } catch (error) {
      await browser?.close();
      browser = undefined;
      context.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.on("session_shutdown", async () => {
    await browser?.close();
    browser = undefined;
  });
}
