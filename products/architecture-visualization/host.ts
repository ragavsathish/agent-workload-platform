import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ViewState = {
  checkpointId: string;
  elements: unknown[];
  warning?: string;
};

const iframe = document.querySelector<HTMLIFrameElement>("#app")!;
const status = document.querySelector<HTMLDivElement>("#status")!;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function main() {
const state = await api<ViewState>("/api/state");
const bridge = new AppBridge(
  null,
  { name: "Pi Wassette prototype", version: "0.0.0" },
  { openLinks: {}, serverTools: {}, logging: {} },
  {
    hostContext: {
      displayMode: "inline",
      availableDisplayModes: ["inline", "fullscreen"],
      containerDimensions: { height: window.innerHeight },
      platform: "desktop",
    },
  },
);

bridge.oncalltool = async (params): Promise<CallToolResult> =>
  api<CallToolResult>("/api/tool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });

bridge.onupdatemodelcontext = async () => ({});
bridge.onloggingmessage = ({ logger, data }) => {
  console.debug(`[${logger ?? "Excalidraw"}]`, data);
};

bridge.onopenlink = async ({ url }) => {
  window.open(url, "_blank", "noopener,noreferrer");
  return {};
};

bridge.onrequestdisplaymode = async ({ mode }) => {
  const actual = mode === "fullscreen" ? "fullscreen" : "inline";
  document.body.dataset.mode = actual;
  bridge.setHostContext({
    displayMode: actual,
    containerDimensions: { height: window.innerHeight },
  });
  return { mode: actual };
};

bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: { elements: JSON.stringify(state.elements) } });
  await bridge.sendToolResult({
    content: [],
    structuredContent: { checkpointId: state.checkpointId },
  });
  status.remove();
};

const connect = bridge.connect(
  new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!),
);
iframe.src = "/mcp-app.html";
await connect;

window.addEventListener("resize", () => {
  bridge.setHostContext({ containerDimensions: { height: window.innerHeight } });
});
}

main().catch((error) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
