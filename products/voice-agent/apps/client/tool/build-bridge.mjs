import { rm } from 'node:fs/promises';

import { build } from 'esbuild';

const outputDirectory = new URL('../web/voice-runtime/', import.meta.url);
const previousOutputDirectory = new URL('../web/bridge/', import.meta.url);
const legacyBundle = new URL('../web/voice_bridge.js', import.meta.url);

await rm(outputDirectory, { force: true, recursive: true });
await rm(previousOutputDirectory, { force: true, recursive: true });
await rm(legacyBundle, { force: true });
await build({
  bundle: true,
  chunkNames: 'chunk-[name]-[hash]',
  entryNames: 'voice_bridge',
  entryPoints: [new URL('../bridge/voice_bridge.js', import.meta.url).pathname],
  format: 'esm',
  minify: true,
  outdir: outputDirectory.pathname,
  splitting: true,
  target: 'es2022',
});

await build({
  bundle: true,
  entryNames: 'mcp_app',
  entryPoints: [new URL('../bridge/voice_canvas_app.js', import.meta.url).pathname],
  format: 'esm',
  minify: true,
  outdir: new URL('../web/voice-canvas/', import.meta.url).pathname,
  target: 'es2022',
});
