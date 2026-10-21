import { cp, mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";

const packageRoot = await realpath(new URL(
  "../node_modules/@agent-workload-platform/journal-review-mcp/",
  import.meta.url,
));
const destination = new URL("../dist/vendor/journal-review-mcp/", import.meta.url);

await mkdir(new URL("app/", destination), { recursive: true });
await Promise.all([
  cp(join(packageRoot, "dist", "stdio-bundle.mjs"), new URL("stdio-bundle.mjs", destination)),
  cp(join(packageRoot, "dist", "app", "main.html"), new URL("app/main.html", destination)),
]);
