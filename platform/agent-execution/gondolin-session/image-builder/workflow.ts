import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

type BuildConfig = {
  context: string;
  dockerfile: string;
  assetConfig: string;
  target?: string;
  contexts?: Record<string, string>;
};

function run(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(`${command} exited with ${code ?? "a signal"}`)));
  });
}

function relative(value: unknown, field: string): string {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    throw new Error(`build.${field} must be a non-empty relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`build.${field} escapes the checkout`);
  }
  return normalized;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function gitObject(revision: string, file: string): Promise<string> {
  const spec = file === "." ? `${revision}^{tree}` : `${revision}:${file}`;
  return run("git", ["rev-parse", spec], process.cwd());
}

export async function workflowPlan(
  requestedVersion: string,
  requestedConfig = ".pi/gondolin.json",
) {
  const revision = await run("git", ["rev-parse", "HEAD"], process.cwd());
  const configPath = relative(requestedConfig, "imageConfig");
  if (!configPath.endsWith(".json")) throw new Error("image config must be a JSON file");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
    image?: unknown;
    build?: BuildConfig;
  };
  if (typeof config.image !== "string" || !config.build) {
    throw new Error(`${configPath} must declare image and build`);
  }
  const build = config.build;
  const context = relative(build.context, "context");
  const dockerfile = relative(build.dockerfile, "dockerfile");
  const assetConfig = relative(build.assetConfig, "assetConfig");
  const namedContexts = Object.fromEntries(
    Object.entries(build.contexts ?? {}).sort().map(([name, value]) => [
      name,
      relative(value, `contexts.${name}`),
    ]),
  );
  if (Object.keys(namedContexts).length > 0) {
    throw new Error("build.contexts are not supported by the host Docker Engine build API yet");
  }
  const dockerfileInContext = path.relative(context, dockerfile);
  if (!dockerfileInContext || dockerfileInContext.startsWith("..") || path.isAbsolute(dockerfileInContext)) {
    throw new Error("build.dockerfile must be inside build.context for host builds");
  }
  const dockerfileSource = fs.readFileSync(dockerfile, "utf8");
  if (/^\s*FROM\s+(?:--platform=\S+\s+)?gitea\.local:3001\//mi.test(dockerfileSource)) {
    throw new Error("host image builds require private registry FROM references to use an overridable ARG");
  }
  const buildArgs = Object.fromEntries([...dockerfileSource.matchAll(/^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(\S+)\s*$/gm)]
    .filter((match) => match[2].includes("gitea.local:3001/"))
    .map((match) => [match[1], match[2].replaceAll("gitea.local:3001", "127.0.0.1:3001")]));
  const inputs = {
    context: await gitObject(revision, context),
    dockerfile: await gitObject(revision, dockerfile),
    assetConfig: await gitObject(revision, assetConfig),
    contexts: Object.fromEntries(await Promise.all(
      Object.entries(namedContexts).map(async ([name, value]) => [name, await gitObject(revision, value)]),
    )),
  };
  const normalized = canonical(build);
  const contract = canonical({ image: config.image, build: normalized, inputs });
  const version = `v2-${createHash("sha256").update(contract).digest("hex").slice(0, 32)}`;
  if (version !== requestedVersion) {
    throw new Error(`artifact version mismatch: requested ${requestedVersion}, source produced ${version}`);
  }
  return {
    artifactVersion: version,
    buildArgs,
    revision,
    assetConfig,
    configPath,
    context,
    dockerfile: dockerfileInContext,
    imageRef: config.image,
    namedContexts,
    target: build.target,
  };
}

async function hostImageBuild(plan: Awaited<ReturnType<typeof workflowPlan>>, baseImagePullToken?: string): Promise<Record<string, unknown>> {
  const apiToken = process.env.DOCKER_JOB_API_VM_TOKEN;
  if (!apiToken) throw new Error("DOCKER_JOB_API_VM_TOKEN is required for the host image builder");
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : "";
  if (!arch) throw new Error(`unsupported builder architecture: ${process.arch}`);
  const contextFile = "/output/context.tar";
  const contextBytes = fs.statSync(contextFile).size;
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(contextFile)) hash.update(chunk);
  const workflowRun = process.env.GITHUB_RUN_ID;
  const workflowAttempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
  if (!workflowRun || !/^\d+$/.test(workflowRun) || !/^\d+$/.test(workflowAttempt)) {
    throw new Error("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must identify the workflow run");
  }
  const runId = `image-${workflowRun}-${workflowAttempt}`;
  const base = "http://compose-cache.local:18080/v1";
  const submitted = await apiRequest(`${base}/jobs`, "POST", apiToken, { "Content-Type": "application/json" }, Buffer.from(JSON.stringify({
    type: "image-build",
    runId,
    revision: plan.revision,
    arch,
    buildManifest: {
      context: ".",
      dockerfile: plan.dockerfile,
      assetConfig: plan.assetConfig,
      artifactVersion: plan.artifactVersion,
      imageRef: plan.imageRef,
      contexts: plan.namedContexts,
      buildArgs: plan.buildArgs,
      target: plan.target,
      baseImagePullToken,
      contextSha256: hash.digest("hex"),
      contextBytes,
    },
  })));
  const job = parseAPIResponse(submitted, "host image-build submission");
  if (typeof job.id !== "string") throw new Error("host image-build response did not contain a job id");
  if (job.status === "awaiting-context") {
    const upload = await apiRequest(`${base}/jobs/${encodeURIComponent(job.id)}/context`, "PUT", apiToken, {
      "Content-Type": "application/x-tar",
      "Content-Length": String(contextBytes),
    }, fs.createReadStream(contextFile));
    parseAPIResponse(upload, "host build context upload");
  }

  for (let attempt = 0; attempt < 1440; attempt += 1) {
    const response = await apiRequest(`${base}/jobs/${encodeURIComponent(job.id)}`, "GET", apiToken);
    const status = parseAPIResponse(response, "host image-build status");
    if (status.status === "succeeded") {
      if (!status.result || typeof status.result !== "object") throw new Error("host build completed without a result manifest");
      return status.result as Record<string, unknown>;
    }
    if (status.status === "failed") throw new Error(`Host image build failed: ${String(status.error ?? "unknown error")}`);
    if (!["awaiting-context", "queued", "running"].includes(String(status.status))) {
      throw new Error(`Unexpected host image-build status: ${String(status.status)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Timed out waiting for host image build (120 minutes)");
}

function apiRequest(
  url: string,
  method: string,
  token: string,
  headers: Record<string, string> = {},
  body?: Buffer | NodeJS.ReadableStream,
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...headers },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }));
      response.once("error", reject);
    });
    request.once("error", reject);
    if (body && "pipe" in body) body.pipe(request);
    else if (body) request.end(body);
    else request.end();
  });
}

function parseAPIResponse(response: { status: number; body: Buffer }, operation: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${operation} returned ${response.status}: ${response.body.toString("utf8").slice(0, 2048)}`);
  }
  return JSON.parse(response.body.toString("utf8")) as Record<string, unknown>;
}

async function main() {
  const requestedVersion = process.env.ARTIFACT_VERSION;
  const imageConfig = process.env.IMAGE_CONFIG ?? ".pi/gondolin.json";
  if (!requestedVersion) throw new Error("ARTIFACT_VERSION is required");
  const plan = await workflowPlan(requestedVersion, imageConfig);
  fs.rmSync("/output", { recursive: true, force: true });
  fs.mkdirSync("/output", { mode: 0o700 });
  await run("tar", ["--exclude=./.git", "-C", plan.context, "-cf", "/output/context.tar", "."]);
  const result = await hostImageBuild(plan, process.env.IMAGE_BASE_PULL_TOKEN);
  fs.writeFileSync("/output/result.json", `${JSON.stringify(result)}\n`, { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
