import fs from "node:fs";
import path from "node:path";

export function taskVmCheckpointPath(sessionFile: string): string {
  return `${path.resolve(sessionFile)}.gondolin.qcow2`;
}

function liveOwner(lockPath: string): boolean {
  const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error(`Invalid Gondolin task VM owner record: ${lockPath}`);
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    return true;
  }
}

/** One Pi process may own a session's writable guest disk at a time. */
export class TaskVmLease {
  private released = false;

  private constructor(readonly checkpointPath: string, private readonly lockPath: string) {}

  static acquire(checkpointPath: string): TaskVmLease {
    const lockPath = `${checkpointPath}.lock`;
    fs.mkdirSync(path.dirname(checkpointPath), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(lockPath, `${process.pid}\n`, { flag: "wx", mode: 0o600 });
        return new TaskVmLease(checkpointPath, lockPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (liveOwner(lockPath)) {
          throw new Error(`Gondolin task VM is already active for ${checkpointPath}`);
        }
        fs.rmSync(lockPath, { force: true });
      }
    }
    throw new Error(`Could not acquire Gondolin task VM: ${checkpointPath}`);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    fs.rmSync(this.lockPath, { force: true });
  }
}

/** Remove a saved disk only when no Pi process owns that session. */
export function disposeTaskVmCheckpoint(sessionFile: string): boolean {
  const checkpointPath = taskVmCheckpointPath(sessionFile);
  const lockPath = `${checkpointPath}.lock`;
  if (fs.existsSync(lockPath)) {
    if (liveOwner(lockPath)) throw new Error(`Gondolin task VM is active for ${sessionFile}`);
    fs.rmSync(lockPath, { force: true });
  }
  if (!fs.existsSync(checkpointPath)) return false;
  fs.rmSync(checkpointPath);
  return true;
}
