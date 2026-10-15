import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

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

const trustedImageCache = "/runner/image-cache";

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

async function importTrustedBaseImages(): Promise<void> {
  if (!fs.existsSync(trustedImageCache)) return;
  for (const entry of fs.readdirSync(trustedImageCache, { withFileTypes: true })
    .filter((candidate) => candidate.isFile() && candidate.name.endsWith(".tar"))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const archive = path.join(trustedImageCache, entry.name);
    const referenceFile = archive.replace(/\.tar$/, ".ref");
    const reference = fs.readFileSync(referenceFile, "utf8").trim();
    if (!reference.startsWith("gitea.local:3001/image-builder/") || /\s/.test(reference)) {
      throw new Error(`invalid trusted base-image reference: ${reference}`);
    }
    const cached = await run("docker", ["image", "inspect", "--format", "{{.Id}}", reference])
      .then(() => true, () => false);
    if (cached) continue;
    await run("docker", ["load", "--input", archive]);
  }
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
await importTrustedBaseImages();
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
await run("docker", ["tag", localTag, plan.registryRef]);
const pushed = await run("docker", ["push", plan.registryRef]);
const digest = pushed.match(/digest:\s+(sha256:[a-f0-9]{64})\b/)?.[1];
if (!digest) throw new Error("docker push did not report an OCI digest");
fs.writeFileSync("/output/result.json", `${JSON.stringify({
  artifactVersion: plan.artifactVersion,
  digest,
  imageRef: plan.imageRef,
  registryRepository: "image-builder/execution-images",
})}\n`, { mode: 0o600 });
