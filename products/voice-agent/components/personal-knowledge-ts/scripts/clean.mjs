import { rmSync } from "node:fs";

for (const directory of ["build", "dist", "src/core/generated"]) {
  rmSync(new URL(`../${directory}`, import.meta.url), { force: true, recursive: true });
}
