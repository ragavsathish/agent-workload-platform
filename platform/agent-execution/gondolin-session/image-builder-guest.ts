import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

type GuestPlan = {
  artifactVersion: string;
  assetConfig: string;
  context: string;
  dockerfile: string;
  imageRef: string;
  namedContexts: Record<string, string>;
  registryRef: string;
  target?: string;
};

function run(
  command: string,
  args: string[],
  input?: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} exited with ${code ?? "a signal"}`)));
    if (input !== undefined) child.stdin!.end(input);
  });
}

function workspacePath(relative: string): string {
  const candidate = path.resolve("/workspace", relative);
  if (candidate !== "/workspace" && !candidate.startsWith("/workspace/")) {
    throw new Error(`Build path escapes /workspace: ${relative}`);
  }
  return candidate;
}

async function sha256(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function exportDockerArchive(image: string, destination: string): Promise<void> {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  const docker = spawn("docker", ["save", image], { stdio: ["ignore", "pipe", "inherit"] });
  const tar = spawn("tar", ["-xf", "-", "-C", destination], {
    stdio: ["pipe", "inherit", "inherit"],
  });
  docker.stdout!.pipe(tar.stdin!);
  const wait = (child: ReturnType<typeof spawn>, name: string) => new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`${name} exited with ${code ?? "a signal"}`)));
  });
  await Promise.all([wait(docker, "docker save"), wait(tar, "tar")]);
}

type RegistryResponse = {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
  status: number;
};

function registryRequest(
  method: string,
  url: string,
  token: string,
  options: {
    body?: Buffer;
    contentType?: string;
    file?: string;
    start?: number;
    end?: number;
  } = {},
): Promise<RegistryResponse> {
  const target = new URL(url);
  if (target.protocol !== "http:" || target.host !== "gitea.local:3001") {
    throw new Error(`registry request escaped the builder endpoint: ${target.origin}`);
  }
  const fileLength = options.file === undefined
    ? undefined
    : (options.end ?? fs.statSync(options.file).size - 1) - (options.start ?? 0) + 1;
  const length = options.body?.length ?? fileLength ?? 0;
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`image-builder:${token}`).toString("base64")}`,
        "Content-Length": String(length),
        ...(options.contentType ? { "Content-Type": options.contentType } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode ?? 0,
      }));
      response.once("error", reject);
    });
    request.once("error", reject);
    if (options.body) {
      request.end(options.body);
    } else if (options.file) {
      fs.createReadStream(options.file, { start: options.start, end: options.end }).pipe(request);
    } else {
      request.end();
    }
  });
}

function nextUploadUrl(location: string | string[] | undefined): string {
  if (typeof location !== "string" || !location) throw new Error("registry omitted upload location");
  const next = new URL(location, "http://gitea.local:3001");
  next.protocol = "http:";
  next.host = "gitea.local:3001";
  if (!next.pathname.startsWith("/v2/image-builder/execution-images/blobs/uploads/")) {
    throw new Error(`registry returned an invalid upload location: ${next.pathname}`);
  }
  return next.toString();
}

async function uploadBlob(file: string, digest: string, token: string): Promise<void> {
  const base = "http://gitea.local:3001/v2/image-builder/execution-images";
  const existing = await registryRequest("HEAD", `${base}/blobs/${digest}`, token);
  if (existing.status === 200) return;
  if (existing.status !== 404) throw new Error(`registry blob probe returned ${existing.status}`);
  const started = await registryRequest("POST", `${base}/blobs/uploads/`, token);
  if (started.status !== 202) throw new Error(`registry upload start returned ${started.status}`);
  let location = nextUploadUrl(started.headers.location);
  const size = fs.statSync(file).size;
  const chunkBytes = 32 * 1024 * 1024;
  for (let start = 0; start < size; start += chunkBytes) {
    const end = Math.min(start + chunkBytes, size) - 1;
    const uploaded = await registryRequest("PATCH", location, token, {
      contentType: "application/octet-stream",
      file,
      start,
      end,
    });
    if (uploaded.status !== 202) {
      throw new Error(`registry blob chunk returned ${uploaded.status}: ${uploaded.body.toString("utf8")}`);
    }
    location = nextUploadUrl(uploaded.headers.location);
  }
  const completed = new URL(location);
  completed.searchParams.set("digest", digest);
  const finalized = await registryRequest("PUT", completed.toString(), token);
  if (finalized.status !== 201) {
    throw new Error(`registry blob finalize returned ${finalized.status}: ${finalized.body.toString("utf8")}`);
  }
}

async function publishOciImage(
  image: string,
  tag: string,
  token: string,
): Promise<string> {
  const archive = "/output/docker-archive";
  fs.rmSync(archive, { recursive: true, force: true });
  await exportDockerArchive(image, archive);
  const saved = JSON.parse(fs.readFileSync(path.join(archive, "manifest.json"), "utf8")) as Array<{
    Config: string;
    Layers: string[];
  }>;
  if (saved.length !== 1) throw new Error(`expected one Docker image, found ${saved.length}`);
  const entry = saved[0];
  const config = workspacePathIn(archive, entry.Config);
  const configDigest = await sha256(config);
  await uploadBlob(config, configDigest, token);
  const layers: Array<{ digest: string; mediaType: string; size: number }> = [];
  for (const [index, relativeLayer] of entry.Layers.entries()) {
    const layer = workspacePathIn(archive, relativeLayer);
    const compressed = `/output/layer-${index}.tar.gz`;
    await pipeline(fs.createReadStream(layer), createGzip({ level: 1 }), fs.createWriteStream(compressed));
    const digest = await sha256(compressed);
    await uploadBlob(compressed, digest, token);
    layers.push({
      digest,
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      size: fs.statSync(compressed).size,
    });
    fs.rmSync(compressed, { force: true });
  }
  const manifest = Buffer.from(JSON.stringify({
    schemaVersion: 2,
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: {
      digest: configDigest,
      mediaType: "application/vnd.oci.image.config.v1+json",
      size: fs.statSync(config).size,
    },
    layers,
  }));
  const digest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
  const published = await registryRequest(
    "PUT",
    `http://gitea.local:3001/v2/image-builder/execution-images/manifests/${encodeURIComponent(tag)}`,
    token,
    { body: manifest, contentType: "application/vnd.oci.image.manifest.v1+json" },
  );
  if (published.status !== 201) {
    throw new Error(`registry manifest upload returned ${published.status}: ${published.body.toString("utf8")}`);
  }
  fs.rmSync(archive, { recursive: true, force: true });
  return digest;
}

function workspacePathIn(root: string, relative: string): string {
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Docker archive path escapes extraction root: ${relative}`);
  }
  return candidate;
}

const [planFile] = process.argv.slice(2);
if (!planFile) throw new Error("usage: image-builder-guest <plan.json>");
const plan = JSON.parse(fs.readFileSync(planFile, "utf8")) as GuestPlan;
const gondolinMitmCa = "/etc/gondolin/mitm/ca.crt";
if (!fs.existsSync(gondolinMitmCa)) {
  throw new Error(`Gondolin MITM CA is unavailable: ${gondolinMitmCa}`);
}
const token = process.env.IMAGE_BUILDER_TOKEN;
if (!token) throw new Error("IMAGE_BUILDER_TOKEN is required");
const registry = plan.registryRef.slice(0, plan.registryRef.indexOf("/"));
if (!registry || registry !== "gitea.local:3001") {
  throw new Error(`unsupported image registry: ${registry || plan.registryRef}`);
}
await run(
  "docker",
  ["login", "--username", "image-builder", "--password-stdin", registry],
  `${token}\n`,
);
const localTag = `local/task-image:${createHash("sha256").update(plan.artifactVersion).digest("hex").slice(0, 20)}`;
const buildArgs = [
  "build",
  "--network=host",
  "--secret", `id=gondolin_mitm_ca,src=${gondolinMitmCa}`,
  "--file", workspacePath(plan.dockerfile),
  "--tag", localTag,
];
if (plan.target) buildArgs.push("--target", plan.target);
for (const [name, relative] of Object.entries(plan.namedContexts).sort()) {
  buildArgs.push("--build-context", `${name}=${workspacePath(relative)}`);
}
buildArgs.push(workspacePath(plan.context));
await run("docker", buildArgs);
const digest = await publishOciImage(localTag, plan.artifactVersion, token);
fs.writeFileSync("/output/result.json", `${JSON.stringify({
  artifactVersion: plan.artifactVersion,
  digest,
  imageRef: plan.imageRef,
  registryRepository: "image-builder/execution-images",
})}\n`, { mode: 0o600 });
