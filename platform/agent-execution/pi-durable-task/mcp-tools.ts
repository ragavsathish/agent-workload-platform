import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { McpClient, StdioTransport, StreamableHttpTransport, toLlmContent,
  type CallToolResult, type Tool } from "@earendil-works/pi-mcp";

export type McpServerConfig = {
  name: string;
  allowedTools: string[];
  safeReplayTools?: string[];
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
};

export type McpToolClient = {
  listTools(): Promise<Tool[]>;
  callTool(name: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<CallToolResult>;
  close(): Promise<void>;
};

const SERVER_NAME = /^[a-z][a-z0-9_-]*$/u;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/u;

export async function connectMcpServer(config: McpServerConfig): Promise<McpToolClient> {
  if (!SERVER_NAME.test(config.name) || Boolean(config.url) === Boolean(config.command)) {
    throw new Error("MCP server requires a valid name and exactly one transport");
  }
  const client = new McpClient({ name: "pi-durable-task", version: "0.1.0" });
  const transport = config.url
    ? new StreamableHttpTransport({ url: config.url, headers: config.headers })
    : new StdioTransport({ command: config.command!, args: config.args ?? [], cwd: config.cwd });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close();
    throw error;
  }
}

export async function createMcpToolExtension(config: McpServerConfig, client: McpToolClient) {
  if (!SERVER_NAME.test(config.name) || config.allowedTools.length === 0) {
    throw new Error("MCP server needs a valid name and explicit tool allowlist");
  }
  const allowed = new Set(config.allowedTools);
  const safe = new Set(config.safeReplayTools ?? []);
  if (safe.size !== (config.safeReplayTools ?? []).length || [...safe].some((name) => !allowed.has(name))) {
    throw new Error("safe replay tools must be unique members of the allowlist");
  }
  const discovered = await client.listTools();
  const selected = discovered.filter((tool) => allowed.has(tool.name));
  if (selected.length !== allowed.size) {
    throw new Error(`MCP server ${config.name} is missing allowlisted tools`);
  }
  const names = new Set<string>();
  const tools = selected.map((tool) => {
    if (!TOOL_NAME.test(tool.name)) throw new Error(`invalid MCP tool name: ${tool.name}`);
    const name = `mcp__${config.name}__${tool.name}`;
    if (name.length > 64 || names.has(name)) throw new Error(`invalid durable MCP name: ${name}`);
    names.add(name);
    const schema = { ...tool.inputSchema, type: "object",
      properties: tool.inputSchema.properties ?? {} };
    return defineTool({
      name,
      description: tool.description ?? tool.title ?? tool.name,
      parameters: Type.Unsafe<Record<string, unknown>>(schema),
      replay: safe.has(tool.name) ? "safe" : "unsafe",
      outputLimits: { maxBytes: 32_768, maxLines: 400 },
      execute: async (args, _api, context) => {
        const result = await client.callTool(tool.name, args, { signal: context.abortSignal });
        return { output: toLlmContent(result), isError: result.isError === true };
      },
    });
  });
  return defineExtension({ name: `mcp-${config.name}`, tools });
}
