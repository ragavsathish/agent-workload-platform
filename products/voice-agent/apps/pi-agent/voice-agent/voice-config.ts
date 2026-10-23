import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelSelector = {
  provider: string;
  modelId: string;
  source: string;
};

export type ServiceSettings = {
  agentDir: string;
  cwd: string;
  giteaEndpointUrl: string;
  giteaOwner: string;
  giteaRepository: string;
  giteaToken: string;
  grafanaMcpToken: string;
  grafanaMcpUrl: string;
  gondolinAssets: string;
  oxigraphUrl: string;
  listenHost: string;
  listenPort: number;
  model?: ModelSelector;
  prometheusEndpointUrl: string;
  remoteTaskSocketDir: string;
  playwrightTraceArtifactRoot: string;
  playwrightTraceOutputRoot: string;
  playwrightTraceRenderer: string;
  playwrightTraceViewerBaseUrl: string;
  sessionDir: string;
  serviceToken: string;
  skillsDir: string;
  s3MockAccessKey: string;
  s3MockBucket: string;
  s3MockEndpointUrl: string;
  s3MockSecretKey: string;
  thinking: ThinkingLevel;
  timeoutMs: number;
  wassetteBin: string;
  wassetteComponentDir: string;
  wassetteEnvFile: string;
};

const thinkingLevels = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function requiredEnv(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function httpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  return url.toString().replace(/\/$/, "");
}

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("PI_VOICE_SERVICE_PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function timeoutMs(value: string): number {
  const parsed = Number(value) * 1_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PI_VOICE_TIMEOUT_SECONDS must be a positive number");
  }
  return parsed;
}

function modelSelector(value: string | undefined): ModelSelector | undefined {
  const source = value?.trim();
  if (!source) return undefined;
  const separator = source.indexOf("/");
  if (separator < 1 || separator === source.length - 1) {
    throw new Error("PI_VOICE_MODEL must use provider/model format");
  }
  return {
    provider: source.slice(0, separator),
    modelId: source.slice(separator + 1),
    source,
  };
}

export async function loadSettings(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ServiceSettings> {
  const env = environment;
  const thinking = (env.PI_VOICE_THINKING?.trim() || "low") as ThinkingLevel;
  if (!thinkingLevels.has(thinking)) throw new Error("invalid PI_VOICE_THINKING");

  const agentDir = resolve(env.PI_CODING_AGENT_DIR || join(env.HOME || "", ".pi/agent"));
  const sessionDir = resolve(env.PI_VOICE_SESSION_DIR || join(agentDir, "voice-sessions"));
  const cwd = resolve(env.PI_VOICE_CWD || process.cwd());
  const skillsDir = resolve(env.PI_VOICE_SKILLS_DIR || join(cwd, "..", "skills"));
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  await chmod(sessionDir, 0o700);

  return {
    agentDir,
    cwd,
    giteaEndpointUrl: httpUrl(requiredEnv(env, "GITEA_ENDPOINT_URL"), "GITEA_ENDPOINT_URL"),
    giteaOwner: requiredEnv(env, "GITEA_OWNER"),
    giteaRepository: env.PI_VOICE_GITEA_REPOSITORY?.trim() || "agent-workload-platform",
    giteaToken: requiredEnv(env, "GITEA_TOKEN"),
    grafanaMcpToken: requiredEnv(env, "GRAFANA_MCP_SERVER_TOKEN"),
    grafanaMcpUrl: httpUrl(requiredEnv(env, "GRAFANA_MCP_URL"), "GRAFANA_MCP_URL"),
    gondolinAssets: resolve(requiredEnv(env, "GONDOLIN_BROWSER_ASSETS")),
    oxigraphUrl: httpUrl(
      env.OXIGRAPH_URL || "http://127.0.0.1:7878",
      "OXIGRAPH_URL",
    ),
    listenHost: env.PI_VOICE_SERVICE_HOST || "127.0.0.1",
    listenPort: port(env.PI_VOICE_SERVICE_PORT || "9446"),
    model: modelSelector(env.PI_VOICE_MODEL || env.PI_MODEL),
    prometheusEndpointUrl: httpUrl(
      env.PROMETHEUS_ENDPOINT_URL || "http://127.0.0.1:9091",
      "PROMETHEUS_ENDPOINT_URL",
    ),
    remoteTaskSocketDir: resolve(
      env.PI_TASK_RPC_SOCKET_DIR
        || `/tmp/awp-pi-rpc-${process.getuid?.() ?? "owner"}`,
    ),
    playwrightTraceArtifactRoot: resolve(env.PLAYWRIGHT_TRACE_ARTIFACT_ROOT || tmpdir()),
    playwrightTraceOutputRoot: resolve(
      env.PLAYWRIGHT_TRACE_OUTPUT_ROOT || join(tmpdir(), "playwright-trace-renders"),
    ),
    playwrightTraceRenderer: resolve(
      env.PLAYWRIGHT_TRACE_RENDERER
        || join(process.cwd(), "products/voice-agent/apps/client/tool/prototype-trace-explainer.mjs"),
    ),
    playwrightTraceViewerBaseUrl: httpUrl(
      env.PLAYWRIGHT_TRACE_VIEWER_BASE_URL || "http://127.0.0.1:9450",
      "PLAYWRIGHT_TRACE_VIEWER_BASE_URL",
    ),
    sessionDir,
    serviceToken: requiredEnv(env, "INFERENCE_BROKER_TOKEN"),
    skillsDir,
    s3MockAccessKey: requiredEnv(env, "ARTIFACT_ACCESS_KEY"),
    s3MockBucket: requiredEnv(env, "ARTIFACT_BUCKET"),
    s3MockEndpointUrl: httpUrl(requiredEnv(env, "ARTIFACT_ENDPOINT_URL"), "ARTIFACT_ENDPOINT_URL"),
    s3MockSecretKey: requiredEnv(env, "ARTIFACT_SECRET_KEY"),
    thinking,
    timeoutMs: timeoutMs(env.PI_VOICE_TIMEOUT_SECONDS || "120"),
    wassetteBin: resolve(requiredEnv(env, "WASSETTE_BIN")),
    wassetteComponentDir: resolve(requiredEnv(env, "WASSETTE_COMPONENT_DIR")),
    wassetteEnvFile: resolve(requiredEnv(env, "WASSETTE_ENV_FILE")),
  };
}
