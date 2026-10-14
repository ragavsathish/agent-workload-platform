import {
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  type BashOperations,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  type EditOperations,
  type ReadOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import {
  createHttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
} from "@earendil-works/gondolin";

const GUEST_WORKSPACE = "/workspace";
export const GUEST_SKILLS = "/skills";
export const GUEST_S3MOCK_ENDPOINT = "http://s3mock.local:9090";
export const GUEST_GITEA_ENDPOINT = "http://gitea.local:3001";

export function registerGondolinMetrics(
  vm: VM,
  label: string,
  directory = process.env.GONDOLIN_METRICS_DIR,
): () => void {
  if (!directory) return () => {};
  const pid = vm.getHostPid();
  if (pid === null) throw new Error("Gondolin VM runner PID is unavailable");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const safeId = vm.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const target = path.join(directory, `${safeId}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({
    id: vm.id,
    label,
    pid,
    ownerPid: process.pid,
    cpus: 2,
    memoryBytes: 2 * 1024 * 1024 * 1024,
  })}\n`, { mode: 0o600 });
  renameSync(temporary, target);
  return () => rmSync(target, { force: true });
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function toGondolinPath(localCwd: string, localPath: string): string {
  const relativePath = path.relative(localCwd, localPath);
  if (relativePath === "") return GUEST_WORKSPACE;
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  return path.posix.join(GUEST_WORKSPACE, ...relativePath.split(path.sep));
}

function createReadOperations(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: async (filePath) => vm.fs.readFile(toGondolinPath(localCwd, filePath)),
    access: async (filePath) => {
      await vm.fs.access(toGondolinPath(localCwd, filePath), { mode: fsConstants.R_OK });
    },
    detectImageMimeType: async (filePath) => {
      const guestPath = toGondolinPath(localCwd, filePath);
      try {
        const result = await vm.exec([
          "/bin/sh",
          "-lc",
          `file --mime-type -b ${shQuote(guestPath)}`,
        ]);
        if (!result.ok) return null;
        const mimeType = result.stdout.trim();
        return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mimeType)
          ? mimeType
          : null;
      } catch {
        return null;
      }
    },
  };
}

function createWriteOperations(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: async (filePath, content) => {
      const guestPath = toGondolinPath(localCwd, filePath);
      await vm.fs.mkdir(path.posix.dirname(guestPath), { recursive: true });
      await vm.fs.writeFile(guestPath, content);
    },
    mkdir: async (directory) => {
      await vm.fs.mkdir(toGondolinPath(localCwd, directory), { recursive: true });
    },
  };
}

function createEditOperations(vm: VM, localCwd: string): EditOperations {
  const read = createReadOperations(vm, localCwd);
  const write = createWriteOperations(vm, localCwd);
  return {
    readFile: read.readFile,
    writeFile: write.writeFile,
    access: async (filePath) => {
      await vm.fs.access(toGondolinPath(localCwd, filePath), {
        mode: fsConstants.R_OK | fsConstants.W_OK,
      });
    },
  };
}

function createBashOperations(vm: VM, localCwd: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      const guestCwd = toGondolinPath(localCwd, cwd);
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = timeout && timeout > 0
        ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeout * 1_000)
        : undefined;
      try {
        const process = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestCwd,
          signal: controller.signal,
          stdout: "pipe",
          stderr: "pipe",
        });
        for await (const chunk of process.output()) onData(chunk.data);
        const result = await process;
        return { exitCode: result.exitCode };
      } catch (error) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function createGondolinTools(vm: VM, localCwd: string) {
  return [
    createReadTool(localCwd, { operations: createReadOperations(vm, localCwd) }),
    createWriteTool(localCwd, { operations: createWriteOperations(vm, localCwd) }),
    createEditTool(localCwd, { operations: createEditOperations(vm, localCwd) }),
    createBashTool(localCwd, {
      operations: createBashOperations(vm, localCwd),
      exposeSessionEnvironment: false,
    }),
  ];
}

type GondolinWorkspaceOptions = {
  giteaEndpointUrl: string;
  giteaOwner: string;
  giteaToken: string;
  imagePath: string;
  localCwd: string;
  skillsDir: string;
  s3MockAccessKey: string;
  s3MockBucket: string;
  s3MockEndpointUrl: string;
  s3MockSecretKey: string;
  sessionLabel?: string;
};

function loopbackOrigin(value: string, service: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(`Gondolin ${service} endpoint must be an HTTP loopback origin with an explicit port`);
  }
  return origin;
}

export function createGondolinServiceAccess(options: GondolinWorkspaceOptions) {
  const s3Upstream = loopbackOrigin(options.s3MockEndpointUrl, "S3Mock");
  const giteaUpstream = loopbackOrigin(options.giteaEndpointUrl, "Gitea");
  const s3Guest = new URL(GUEST_S3MOCK_ENDPOINT);
  s3Guest.port = s3Upstream.port;
  const giteaGuest = new URL(GUEST_GITEA_ENDPOINT);
  giteaGuest.port = giteaUpstream.port;
  const { httpHooks, env } = createHttpHooks({
    allowedHosts: [],
    allowedInternalHosts: [s3Upstream.hostname],
    onRequest: (request) => {
      const requested = new URL(request.url);
      const route = [
        { guest: s3Guest, upstream: s3Upstream },
        { guest: giteaGuest, upstream: giteaUpstream },
      ].find(({ guest }) => requested.hostname === guest.hostname && requested.port === guest.port);
      if (!route) {
        return new Response("network destination denied", { status: 403 });
      }
      requested.protocol = route.upstream.protocol;
      requested.hostname = route.upstream.hostname;
      requested.port = route.upstream.port;
      return new Request(requested, request);
    },
  });
  return {
    httpHooks,
    env: {
      ...env,
      AWS_ACCESS_KEY_ID: options.s3MockAccessKey,
      AWS_SECRET_ACCESS_KEY: options.s3MockSecretKey,
      AWS_DEFAULT_REGION: "us-east-1",
      AWS_REGION: "us-east-1",
      S3_BUCKET: options.s3MockBucket,
      S3_ENDPOINT_URL: s3Guest.origin,
      GITEA_BASE_URL: giteaGuest.origin,
      GITEA_OWNER: options.giteaOwner,
    },
  };
}

export function createGondolinMounts(options: GondolinWorkspaceOptions) {
  return {
    [GUEST_WORKSPACE]: new RealFSProvider(options.localCwd),
    [GUEST_SKILLS]: new ReadonlyProvider(new RealFSProvider(options.skillsDir)),
  };
}

export class GondolinWorkspace {
  private constructor(
    private readonly vm: VM,
    private readonly localCwd: string,
    private readonly unregisterMetrics: () => void,
  ) {}

  static async create(options: GondolinWorkspaceOptions): Promise<GondolinWorkspace> {
    if (!existsSync(options.imagePath)) {
      throw new Error(`Missing Gondolin assets: ${options.imagePath}`);
    }
    if (!existsSync(options.skillsDir)) {
      throw new Error(`Missing skills directory: ${options.skillsDir}`);
    }
    const serviceAccess = createGondolinServiceAccess(options);
    const vm = await VM.create({
      sandbox: { imagePath: options.imagePath },
      dns: { mode: "synthetic", syntheticHostMapping: "per-host" },
      env: serviceAccess.env,
      httpHooks: serviceAccess.httpHooks,
      vfs: {
        mounts: createGondolinMounts(options),
      },
      memory: "2G",
      cpus: 2,
      sessionLabel: options.sessionLabel ?? "pi-voice",
    });
    const teaLogin = await vm.exec([
      "/usr/local/bin/tea",
      "login",
      "add",
      "--name",
      "local",
      "--url",
      new URL(GUEST_GITEA_ENDPOINT).origin,
      "--token",
      options.giteaToken,
      "--no-version-check",
    ]);
    if (!teaLogin.ok) {
      await vm.close();
      throw new Error("Could not configure the scoped Gitea CLI login");
    }
    let unregisterMetrics: () => void;
    try {
      unregisterMetrics = registerGondolinMetrics(
        vm,
        options.sessionLabel ?? "pi-voice",
      );
    } catch (error) {
      await vm.close();
      throw error;
    }
    return new GondolinWorkspace(vm, options.localCwd, unregisterMetrics);
  }

  tools() {
    return createGondolinTools(this.vm, this.localCwd);
  }

  async close(): Promise<void> {
    try {
      await this.vm.close();
    } finally {
      this.unregisterMetrics();
    }
  }
}
