import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const DOCKER_KINDS = new Map([
  ["Images", "images"],
  ["Containers", "containers"],
  ["Local Volumes", "volumes"],
  ["Build Cache", "build_cache"],
]);

export function parseHumanBytes(value) {
  const match = /^\s*([\d.]+)\s*(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)\b/i.exec(value);
  if (!match) throw new Error("invalid Docker size");
  const number = Number(match[1]);
  const unit = match[2].toLowerCase();
  const factors = { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4 };
  if (!Number.isFinite(number)) throw new Error("invalid Docker size");
  return number * factors[unit];
}

export function parseDockerSystemDf(output) {
  const result = new Map();
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const row = JSON.parse(line);
    const kind = DOCKER_KINDS.get(row.Type);
    if (!kind) continue;
    result.set(kind, {
      size: parseHumanBytes(row.Size),
      reclaimable: parseHumanBytes(row.Reclaimable),
    });
  }
  return result;
}

export function storageRecords(directories, docker) {
  const records = [];
  for (const [area, bytes] of directories) {
    records.push({ metric: "directory", area, bytes });
  }
  for (const [kind, values] of docker) {
    records.push({ metric: "docker_size", kind, bytes: values.size });
    records.push({ metric: "docker_reclaimable", kind, bytes: values.reclaimable });
  }
  return records;
}

export async function collectStorage(artifactsDirectory, runtimeRoot = path.join(os.homedir(), "Library/Application Support/PipecatEdge")) {
  const directories = new Map([
    ["gondolin_images", path.join(os.homedir(), ".cache/gondolin/images")],
    ["image_handoff", path.join(runtimeRoot, "gondolin-image-handoff")],
    ["builder_assets", path.join(runtimeRoot, "gondolin-builder-assets")],
    ...(artifactsDirectory ? [["repository_artifacts", artifactsDirectory]] : []),
  ]);
  const directorySizes = new Map();
  const samples = await Promise.all([...directories].map(async ([area, directory]) => {
    try {
      const { stdout } = await run("du", ["-sk", directory], { timeout: 30_000 });
      const kib = Number(stdout.match(/^\s*(\d+)/)?.[1]);
      return Number.isFinite(kib) ? [area, kib * 1024] : null;
    } catch {
      return null;
    }
  }));
  for (const sample of samples) if (sample) directorySizes.set(...sample);
  let dockerSizes = new Map();
  try {
    const { stdout } = await run(
      process.env.DOCKER_BIN ?? "/usr/local/bin/docker",
      ["system", "df", "--format", "{{json .}}"],
      { timeout: 30_000 },
    );
    dockerSizes = parseDockerSystemDf(stdout);
  } catch {
    // Docker can be unavailable while Desktop is starting.
  }
  return storageRecords(directorySizes, dockerSizes);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  collectStorage(process.env.STORAGE_ARTIFACTS_DIR)
    .then((records) => { for (const record of records) console.log(JSON.stringify(record)); })
    .catch((error) => { console.error(error); process.exitCode = 1; });
}
