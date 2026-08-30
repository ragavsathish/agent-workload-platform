import path from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: __dirname,
  plugins: [viteSingleFile()],
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "host.html"),
    },
  },
});
