import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const adapterDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(adapterDir, "scripts"),
  build: {
    outDir: path.join(adapterDir, "dist", "browser"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(adapterDir, "scripts", "converter.html"),
    },
  },
});
