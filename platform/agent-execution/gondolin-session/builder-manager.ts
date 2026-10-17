import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { configureTelemetry } from "@agent-workload-platform/otel";

import {
  createHttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  VmCheckpoint,
  type ExecProcess,
} from "@earendil-works/gondolin";

export const BUILDER_LABEL = "gondolin-builder:host";
export const DEFAULT_BUILDER_DISK = "128G";
const GITEA_GUEST_ORIGIN = "http://gitea.local:3001";
const OTEL_GUEST_ORIGIN = "http://otel.local:4318";

function loopbackEndpoint(endpoint: string, name: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error(`Builder ${name} endpoint must be HTTP loopback with an explicit port`);
  }
  return url;
}

export function createBuilderServiceAccess(giteaEndpoint: string, otelEndpoint: string) {
  const giteaUpstream = loopbackEndpoint(giteaEndpoint, "Gitea");
  const otelUpstream = loopbackEndpoint(otelEndpoint, "OTel");
  const giteaGuest = new URL(GITEA_GUEST_ORIGIN);
  giteaGuest.port = giteaUpstream.port;
  const otelGuest = new URL(OTEL_GUEST_ORIGIN);
  otelGuest.port = otelUpstream.port;
  const route = (requested: URL) => {
    if (requested.hostname === giteaGuest.hostname && requested.port === giteaGuest.port) {
      return giteaUpstream;
    }
    if (requested.hostname === otelGuest.hostname && requested.port === otelGuest.port) {
      return otelUpstream;
    }
    return undefined;
  };
  return createHttpHooks({
    allowedHosts: ["*"],
    allowedInternalHosts: [giteaUpstream.hostname, otelUpstream.hostname],
    onRequest: (request) => {
      const requested = new URL(request.url);
      const upstream = route(requested);
      if (!upstream) {
        if (requested.hostname === "127.0.0.1" || requested.hostname === "localhost") {
          return new Response("network destination denied", { status: 403 });
        }
        return request;
      }
      requested.protocol = upstream.protocol;
      requested.hostname = upstream.hostname;
      requested.port = upstream.port;
      return new Request(requested, request);
    },
    onResponse: (response) => {
      const challenge = response.headers.get("www-authenticate");
      if (!challenge) return response;
      const hostRealm = `${giteaUpstream.origin}/v2/token`;
      if (!challenge.includes(`realm="${hostRealm}"`)) return response;
      const headers = new Headers(response.headers);
      headers.set("www-authenticate", challenge.replace(
        `realm="${hostRealm}"`,
        `realm="${giteaGuest.origin}/v2/token"`,
      ));
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    },
  });
}

export function runnerRegistrationCommand(): string[] {
  return [
    "/usr/local/bin/gitea-runner",
    "register",
    "--no-interactive",
    "--instance",
    GITEA_GUEST_ORIGIN,
    "--name",
    "shared-gondolin-builder",
    "--labels",
    BUILDER_LABEL,
  ];
}

type BuilderManagerOptions = {
  checkpointPath: string;
  giteaEndpoint: string;
  imagePath: string;
  otelEndpoint: string;
  registrationToken: string;
  runnerDirectory: string;
};

export class BuilderManager {
  private vm?: VM;
  private daemon?: ExecProcess;
  private runner?: ExecProcess;

  constructor(private readonly options: BuilderManagerOptions) {}

  async start(): Promise<void> {
    const service = createBuilderServiceAccess(this.options.giteaEndpoint, this.options.otelEndpoint);
    const vmOptions = {
      sandbox: { imagePath: this.options.imagePath, netEnabled: true },
      dns: { mode: "synthetic" as const, syntheticHostMapping: "per-host" as const },
      httpHooks: service.httpHooks,
      env: service.env,
      memory: process.env.GONDOLIN_BUILDER_MEMORY ?? "8G",
      cpus: Number(process.env.GONDOLIN_BUILDER_CPUS ?? "4"),
      rootfs: {
        mode: "cow" as const,
        size: process.env.GONDOLIN_BUILDER_DISK ?? DEFAULT_BUILDER_DISK,
      },
      vfs: {
        mounts: {
          "/runner": new ReadonlyProvider(new RealFSProvider(this.options.runnerDirectory)),
        },
      },
      sessionLabel: "shared-image-builder",
    };
    this.vm = fs.existsSync(this.options.checkpointPath)
      ? await VmCheckpoint.load(this.options.checkpointPath).resume<VM>(vmOptions)
      : await VM.create(vmOptions);
    const vm = this.vm;
    const setup = await vm.exec([
      "/bin/sh",
      "-lc",
      "mkdir -p /sys/fs/cgroup /var/lib/gitea-runner && "
        + "(mountpoint -q /sys/fs/cgroup || mount -t cgroup2 none /sys/fs/cgroup)",
    ]);
    if (!setup.ok) throw new Error(`Could not prepare builder VM: ${setup.stderr}`);

    this.daemon = vm.exec([
      "/bin/sh",
      "-lc",
      "exec dockerd --host=unix:///var/run/docker.sock --storage-driver=overlay2 "
        + "--insecure-registry=gitea.local:3001 "
        + "--iptables=false --bridge=none --ip-forward=false --ip-masq=false "
        + ">/var/log/dockerd.log 2>&1",
    ]);
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const probe = await vm.exec(["docker", "info", "--format", "{{.Driver}}"]).catch(() => undefined);
      if (probe?.ok && probe.stdout.trim() === "overlay2") break;
      if (attempt === 119) throw new Error("Private Docker daemon did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const registered = await vm.exec(["test", "-s", "/var/lib/gitea-runner/.runner"]);
    if (!registered.ok) {
      const registration = await vm.exec(runnerRegistrationCommand(), {
        cwd: "/var/lib/gitea-runner",
        env: { GITEA_RUNNER_REGISTRATION_TOKEN: this.options.registrationToken },
      });
      if (!registration.ok) throw new Error(`Could not register Gitea runner: ${registration.stderr}`);
    }
    this.runner = vm.exec(
      ["/usr/local/bin/gitea-runner", "daemon", "--labels", BUILDER_LABEL],
      {
        cwd: "/var/lib/gitea-runner",
        env: {
          OTEL_EXPORTER_OTLP_ENDPOINT: OTEL_GUEST_ORIGIN,
          OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
          OTEL_LOGS_EXPORTER: "none",
          OTEL_METRIC_EXPORT_INTERVAL: "5000",
          OTEL_SERVICE_NAME: "pipecat-gitea-runner",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    this.runner.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    this.runner.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  }

  async wait(): Promise<void> {
    if (!this.runner) throw new Error("Builder manager has not started");
    const result = await this.runner.result;
    if (!result.ok) throw new Error(`Gitea runner exited with ${result.exitCode}`);
  }

  async stop(): Promise<void> {
    const vm = this.vm;
    if (!vm) return;
    await vm.exec(["/bin/sh", "-lc", "pkill -TERM gitea-runner || true; pkill -TERM dockerd || true"])
      .catch(() => undefined);
    await Promise.race([
      Promise.allSettled([this.runner?.result, this.daemon?.result]),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
    const temporary = `${this.options.checkpointPath}.next`;
    fs.mkdirSync(path.dirname(this.options.checkpointPath), { recursive: true, mode: 0o700 });
    fs.rmSync(temporary, { force: true });
    await vm.checkpoint(temporary);
    fs.renameSync(temporary, this.options.checkpointPath);
    this.vm = undefined;
  }
}

async function main() {
  const required = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const manager = new BuilderManager({
    checkpointPath: required("GONDOLIN_BUILDER_CHECKPOINT"),
    giteaEndpoint: required("GITEA_ENDPOINT_URL"),
    imagePath: required("GONDOLIN_BUILDER_ASSETS"),
    otelEndpoint: required("OTEL_EXPORTER_OTLP_ENDPOINT"),
    registrationToken: required("GITEA_RUNNER_REGISTRATION_TOKEN"),
    runnerDirectory: fs.realpathSync(required("GONDOLIN_RUNNER_DIR")),
  });
  const telemetry = configureTelemetry("pipecat-image-builder");
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= manager.stop();
    return stopPromise;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  try {
    await telemetry.observe("builder.start", () => manager.start());
    await manager.wait();
  } finally {
    await stop();
    await telemetry.shutdown();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
