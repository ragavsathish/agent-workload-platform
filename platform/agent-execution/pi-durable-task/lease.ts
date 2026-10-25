import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function watchParent(pid: number | undefined): NodeJS.Timeout | undefined {
  if (!pid || !Number.isInteger(pid) || pid <= 1) return undefined;
  const timer = setInterval(() => {
    if (!processAlive(pid)) process.exit(1);
  }, 500);
  timer.unref();
  return timer;
}

export async function acquireStoreOwner(storagePath: string): Promise<() => Promise<void>> {
  const lock = `${storagePath}.owner`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(`${lock}/pid`, String(process.pid), { mode: 0o600 });
      return async () => {
        const owner = Number(await readFile(`${lock}/pid`, "utf8").catch(() => ""));
        if (owner === process.pid) await rm(lock, { recursive: true, force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const owner = Number(await readFile(`${lock}/pid`, "utf8").catch(() => ""));
      if (!owner) {
        const age = Date.now() - (await stat(lock)).mtimeMs;
        if (age < 2_000) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
      }
      if (!processAlive(owner)) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Pi Durable store is already owned by a live task process");
}
