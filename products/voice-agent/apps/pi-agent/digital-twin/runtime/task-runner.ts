import process from "node:process";

import { GondolinSession, type GondolinSessionOptions } from "@agent-workload-platform/gondolin-session";

const GUEST_MODEL_ORIGIN = "http://model.local:11434";
const GUEST_WRITER_ORIGIN = "http://writer.local:9444";

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loopbackOrigin(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error(`${name} must be an HTTP loopback endpoint with an explicit port`);
  }
  return url;
}

export function digitalTwinVmConfig(environment: NodeJS.ProcessEnv): GondolinSessionOptions {
  const modelUpstream = loopbackOrigin(
    environment.DIGITAL_TWIN_MODEL_BASE_URL ?? "http://127.0.0.1:11434",
    "digital twin model endpoint",
  );
  const writerUpstream = loopbackOrigin(
    environment.DIGITAL_TWIN_WRITER_BASE_URL ?? "http://127.0.0.1:9444",
    "digital twin writer endpoint",
  );
  const modelGuest = new URL(GUEST_MODEL_ORIGIN);
  modelGuest.port = modelUpstream.port;
  const writerGuest = new URL(GUEST_WRITER_ORIGIN);
  writerGuest.port = writerUpstream.port;
  return {
    imagePath: environment.DIGITAL_TWIN_IMAGE_REF?.trim() || "digital-twin-ingest:v1",
    network: {
      allowedHosts: [],
      allowedInternalHosts: ["127.0.0.1"],
      onRequest: (request) => {
        const requested = new URL(request.url);
        const route = requested.hostname === modelGuest.hostname && requested.port === modelGuest.port
          ? modelUpstream
          : requested.hostname === writerGuest.hostname && requested.port === writerGuest.port
            ? writerUpstream
            : undefined;
        if (!route) return new Response("network destination denied", { status: 403 });
        requested.protocol = route.protocol;
        requested.hostname = route.hostname;
        requested.port = route.port;
        return new Request(requested, request);
      },
    },
    environment: {
      DIGITAL_TWIN_MODEL_BASE_URL: modelGuest.origin,
      DIGITAL_TWIN_MODEL: environment.DIGITAL_TWIN_MODEL?.trim() || "qwen3.5:9b-mlx",
      DIGITAL_TWIN_WRITER_URL: `${writerGuest.origin}/v1/digital-twin/journal`,
      DIGITAL_TWIN_WRITER_TOKEN: required(environment, "DIGITAL_TWIN_WRITER_TOKEN"),
    },
    dns: { mode: "synthetic", syntheticHostMapping: "per-host" },
    sandbox: { qemuIdlePauseMs: 0 },
    memory: "1G",
    cpus: 1,
    sessionLabel: "digital-twin-ingest",
  };
}

export async function runDigitalTwinTask(
  payload: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const session = new GondolinSession(digitalTwinVmConfig(environment));
  try {
    const result = await session.run(["/usr/bin/node", "/app/processor.mjs"], {
      input: payload,
      signal: AbortSignal.timeout(120_000),
    });
    if (!result.ok) throw new Error(`digital twin guest failed: ${result.stderr.slice(-2_000)}`);
    const output: unknown = JSON.parse(result.stdout);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      throw new Error("digital twin guest returned an invalid result");
    }
    return output as Record<string, unknown>;
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  let payload = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) payload += chunk;
  if (!payload.trim()) throw new Error("digital twin task payload is required on stdin");
  process.stdout.write(`${JSON.stringify(await runDigitalTwinTask(payload))}\n`);
}

if (process.argv[1]?.endsWith("task-runner.js")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
