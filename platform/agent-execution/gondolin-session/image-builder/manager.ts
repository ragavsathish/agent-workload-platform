import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
// Trusted builder VM Docker builds may fetch large OCI layers. Keep the larger
// response cap on this VM rather than widening ordinary task egress.
const BUILDER_MAX_HTTP_RESPONSE_BYTES = 1024 * 1024 * 1024;
const GITEA_GUEST_ORIGIN = "http://gitea.local:3001";
const OTEL_GUEST_ORIGIN = "http://otel.local:4318";
const COMPOSE_CACHE_GUEST_ORIGIN = "http://compose-cache.local:18080";

type ComposeService = { image?: unknown; build?: unknown };
type ComposeConfig = { services?: Record<string, ComposeService> };
type ComposeCacheRequest = {
  arch?: unknown;
  composeConfig?: unknown;
  revision?: unknown;
  runId?: unknown;
};

type ComposeCacheJob =
  | { status: "queued" | "running" }
  | { status: "failed"; error: string }
  | { status: "ready"; handoff: string; cacheId: string; images: number; services: number };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => { hash.update(chunk); });
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

function hostDockerCommand(): string {
  if (process.env.GONDOLIN_HOST_DOCKER) return process.env.GONDOLIN_HOST_DOCKER;
  const pathCandidates = (process.env.PATH ?? "").split(path.delimiter)
    .map((directory) => path.join(directory, "docker"));
  const candidates = [
    ...pathCandidates,
    path.join(os.userInfo().homedir, ".rd", "bin", "docker"),
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/usr/bin/docker",
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "docker";
}

function runHostCommand(command: string, args: string[], quietStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, HOME: os.userInfo().homedir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (!quietStderr) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (!quietStderr) process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} ${args[0]} exited with ${code ?? "a signal"}${stderr.trim() ? `: ${stderr.trim()}` : ""}`)));
  });
}

function hostDockerImageId(image: string): Promise<string | undefined> {
  return runHostCommand(hostDockerCommand(), ["image", "inspect", image, "--format", "{{.Id}}"], true)
    .then((imageId) => /^sha256:[a-f0-9]{64}$/.test(imageId) ? imageId : undefined)
    .catch(() => undefined);
}

export class ComposeCacheHostService {
  private readonly jobs = new Map<string, ComposeCacheJob>();

  constructor(private readonly handoffDirectory: string, private readonly token: string) {}

  async handle(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.hostname !== "compose-cache.local" || url.port !== "18080") return undefined;
    if (request.headers.get("authorization") !== `Bearer ${this.token}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (request.method === "POST" && url.pathname === "/v1/prepare") {
      return this.startJob(request);
    }
    if (request.method === "GET" && url.pathname === "/v1/status") {
      const runId = url.searchParams.get("runId") ?? "";
      const job = this.jobs.get(runId);
      return job
        ? Response.json(job)
        : Response.json({ error: "unknown cache preparation run" }, { status: 404 });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async startJob(request: Request): Promise<Response> {
    const body = await request.arrayBuffer();
    if (body.byteLength > 4 * 1024 * 1024) {
      return Response.json({ error: "Compose config exceeds 4 MiB" }, { status: 413 });
    }
    let input: ComposeCacheRequest;
    try {
      input = JSON.parse(new TextDecoder().decode(body)) as ComposeCacheRequest;
    } catch {
      return Response.json({ error: "request must contain JSON" }, { status: 400 });
    }
    if (typeof input.runId !== "string" || !/^[A-Za-z0-9.-]{1,80}$/.test(input.runId)
        || typeof input.revision !== "string" || !/^[a-f0-9]{40,64}$/.test(input.revision)
        || typeof input.arch !== "string" || !["aarch64", "x86_64"].includes(input.arch)
        || input.arch !== (process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : "unsupported")) {
      return Response.json({ error: "invalid run ID, revision, or host architecture" }, { status: 400 });
    }
    if (!input.composeConfig || typeof input.composeConfig !== "object" || Array.isArray(input.composeConfig)) {
      return Response.json({ error: "composeConfig must be an object" }, { status: 400 });
    }
    const current = this.jobs.get(input.runId);
    if (current) return Response.json(current, { status: 202 });
    this.jobs.set(input.runId, { status: "queued" });
    void this.prepare(input as Required<ComposeCacheRequest>).then(
      (result) => this.jobs.set(input.runId as string, result),
      (error: unknown) => this.jobs.set(input.runId as string, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ status: "queued" }, { status: 202 });
  }

  private async prepare(input: Required<ComposeCacheRequest>): Promise<ComposeCacheJob> {
    this.jobs.set(input.runId as string, { status: "running" });
    const config = input.composeConfig as ComposeConfig;
    const composeServices = config.services;
    if (!composeServices || typeof composeServices !== "object" || Array.isArray(composeServices)) {
      throw new Error("Compose configuration has no services map");
    }
    const serviceImages = new Map<string, { source: string; imageId: string; tag: string; key: string }>();
    for (const [name, service] of Object.entries(composeServices)) {
      if (!service || typeof service !== "object") throw new Error(`invalid Compose service: ${name}`);
      if (service.build !== undefined) continue;
      if (service.image === undefined) continue;
      if (typeof service.image !== "string" || service.image.length > 512
          || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(service.image)) {
        throw new Error(`invalid image reference for Compose service ${name}`);
      }
      if (serviceImages.size >= 128) throw new Error("Compose config has too many image services");
      let imageId = await hostDockerImageId(service.image);
      if (!imageId) {
        await runHostCommand(hostDockerCommand(), ["pull", service.image]);
        imageId = await hostDockerImageId(service.image);
      }
      if (!imageId) throw new Error(`host Docker could not resolve image ${service.image}`);
      const key = sha256(`${service.image}\n${imageId}`).slice(0, 24);
      serviceImages.set(name, { source: service.image, imageId, key, tag: `gondolin-preload:${key}` });
    }
    const images = new Map([...serviceImages.values()].map((image) => [image.tag, image]));
    if (images.size === 0) throw new Error("Compose configuration has no images to cache");
    const cacheEntries = [...images.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([tag, image]) => [tag, { source: image.source, imageId: image.imageId }]);
    const cacheId = sha256(JSON.stringify(cacheEntries));
    const staging = path.join(this.handoffDirectory, `${input.revision}-${input.arch}-${input.runId}.partial`);
    const handoffRoot = path.join(this.handoffDirectory, `${input.revision}-${input.arch}-${input.runId}-${cacheId}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(path.join(staging, "agent", "images"), { recursive: true, mode: 0o700 });
    try {
      for (const image of images.values()) {
        await runHostCommand(hostDockerCommand(), ["tag", image.imageId, image.tag]);
        await runHostCommand(hostDockerCommand(), ["save", "--output", path.join(staging, "agent", "images", `${image.key}.tar`), image.tag]);
      }
      const services = Object.fromEntries([...serviceImages.entries()].map(([name, image]) => [name, {
        image: image.tag,
        pull_policy: "never",
      }]));
      const indexServices: Record<string, { image: string; archive: string; sha256: string }> = {};
      for (const [name, image] of serviceImages) {
        indexServices[name] = {
          image: image.tag,
          archive: `${image.key}.tar`,
          sha256: await sha256File(path.join(staging, "agent", "images", `${image.key}.tar`)),
        };
      }
      fs.writeFileSync(path.join(staging, "compose.override.json"), `${JSON.stringify({ services }, null, 2)}\n`);
      fs.writeFileSync(path.join(staging, "index.json"), `${JSON.stringify({ services: indexServices }, null, 2)}\n`);
      fs.writeFileSync(path.join(staging, "cache-id"), `${cacheId}\n`);
      fs.renameSync(staging, handoffRoot);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
    return { status: "ready", handoff: handoffRoot, cacheId, images: images.size, services: serviceImages.size };
  }
}

function loopbackEndpoint(endpoint: string, name: string): URL {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) {
    throw new Error(`Builder ${name} endpoint must be HTTP loopback with an explicit port`);
  }
  return url;
}

export function createBuilderServiceAccess(
  giteaEndpoint: string,
  otelEndpoint: string,
  composeCacheService?: ComposeCacheHostService,
) {
  const giteaUpstream = loopbackEndpoint(giteaEndpoint, "Gitea");
  const otelUpstream = loopbackEndpoint(otelEndpoint, "OTel");
  const giteaGuest = new URL(GITEA_GUEST_ORIGIN);
  giteaGuest.port = giteaUpstream.port;
  const otelGuest = new URL(OTEL_GUEST_ORIGIN);
  otelGuest.port = otelUpstream.port;
  const composeCacheGuest = new URL(COMPOSE_CACHE_GUEST_ORIGIN);
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
    allowedInternalHosts: [giteaUpstream.hostname, otelUpstream.hostname, composeCacheGuest.hostname],
    onRequest: async (request) => {
      const requested = new URL(request.url);
      const composeCacheResponse = await composeCacheService?.handle(request);
      if (composeCacheResponse) return composeCacheResponse;
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
  private readonly composeCacheToken = randomBytes(32).toString("hex");

  constructor(private readonly options: BuilderManagerOptions) {}

  async start(): Promise<void> {
    const imageHandoffDirectory = path.join(path.dirname(this.options.runnerDirectory), "gondolin-image-handoff");
    const composeCacheHandoffDirectory = path.join(
      path.dirname(this.options.runnerDirectory), "gondolin-compose-cache-handoff",
    );
    fs.mkdirSync(imageHandoffDirectory, { recursive: true, mode: 0o700 });
    fs.mkdirSync(composeCacheHandoffDirectory, { recursive: true, mode: 0o700 });
    const composeCacheService = new ComposeCacheHostService(composeCacheHandoffDirectory, this.composeCacheToken);
    const service = createBuilderServiceAccess(
      this.options.giteaEndpoint,
      this.options.otelEndpoint,
      composeCacheService,
    );
    const vmOptions = {
      sandbox: { imagePath: this.options.imagePath, netEnabled: true },
      dns: { mode: "synthetic" as const, syntheticHostMapping: "per-host" as const },
      httpHooks: service.httpHooks,
      maxHttpResponseBodyBytes: BUILDER_MAX_HTTP_RESPONSE_BYTES,
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
          "/image-handoff": new RealFSProvider(imageHandoffDirectory),
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
          COMPOSE_CACHE_HOST_TOKEN: this.composeCacheToken,
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
