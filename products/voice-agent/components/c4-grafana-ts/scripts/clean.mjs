import { rmSync } from "node:fs";

for (const directory of ["build", "dist", "src/generated"]) {
  rmSync(new URL(`../${directory}`, import.meta.url), { force: true, recursive: true });
}
