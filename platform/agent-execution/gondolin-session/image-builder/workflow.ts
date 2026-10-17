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
  publish?: boolean;
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
  if (build.publish !== undefined && typeof build.publish !== "boolean") {
    throw new Error("build.publish must be a boolean");
  }
  const namedContexts = Object.fromEntries(
    Object.entries(build.contexts ?? {}).sort().map(([name, value]) => [
      name,
      relative(value, `contexts.${name}`),
    ]),
  );
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
    assetConfig,
    configPath,
    context,
    dockerfile,
    imageRef: config.image,
    namedContexts,
    publish: build.publish ?? true,
    registryRef: `gitea.local:3001/image-builder/execution-images:${version}`,
    target: build.target,
  };
}

async function upload(file: string, url: string, token: string): Promise<void> {
  const size = fs.statSync(file).size;
  const status = await new Promise<number>((resolve, reject) => {
    const request = http.request(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        "Content-Length": size,
        "Content-Type": "application/octet-stream",
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    fs.createReadStream(file).pipe(request);
  });
  if (status >= 200 && status < 300) return;
  if (status !== 409 || await sha256Url(url, token) !== await sha256File(file)) {
    throw new Error(`package upload returned ${status}`);
  }
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function sha256Url(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers: { Authorization: `token ${token}` } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`existing package download returned ${response.statusCode}`));
        return;
      }
      const hash = createHash("sha256");
      response.on("data", (chunk) => hash.update(chunk));
      response.once("end", () => resolve(hash.digest("hex")));
      response.once("error", reject);
    });
    request.once("error", reject);
  });
}

async function main() {
  const requestedVersion = process.env.ARTIFACT_VERSION;
  const imageConfig = process.env.IMAGE_CONFIG ?? ".pi/gondolin.json";
  const token = process.env.IMAGE_BUILDER_TOKEN;
  if (!requestedVersion || !token) throw new Error("ARTIFACT_VERSION and IMAGE_BUILDER_TOKEN are required");
  const plan = await workflowPlan(requestedVersion, imageConfig);
  fs.rmSync("/workspace", { recursive: true, force: true });
  fs.rmSync("/output", { recursive: true, force: true });
  fs.symlinkSync(process.cwd(), "/workspace", "dir");
  fs.mkdirSync("/output", { mode: 0o700 });
  fs.writeFileSync("/output/plan.json", `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  await run("node", ["/runner/dist/image-builder/guest.js", "/output/plan.json"]);
  const base = `http://gitea.local:3001/api/packages/image-builder/generic/execution-images/${requestedVersion}`;
  await upload("/output/result.json", `${base}/manifest.json`, token);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
