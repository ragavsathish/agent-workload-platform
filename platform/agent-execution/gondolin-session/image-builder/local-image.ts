import { createHash } from "node:crypto";

export function localImageTag(artifactVersion: string): string {
  return `local/task-image:${createHash("sha256").update(artifactVersion).digest("hex").slice(0, 20)}`;
}
