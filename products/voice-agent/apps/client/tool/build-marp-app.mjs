import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';

import { build } from 'esbuild';

import { buildMcpAppHtml } from './mcp-app-html.mjs';

const outputDirectory = new URL('../web/marp/', import.meta.url);
const fontsSource = new URL('../node_modules/katex/dist/fonts/', import.meta.url);
const fontsOutput = new URL('../web/marp/fonts/', import.meta.url);

await rm(outputDirectory, { force: true, recursive: true });
await buildMcpAppHtml({
  bundle: build,
  entryPoint: new URL('../bridge/marp_app.js', import.meta.url),
  template: new URL('../marp_app/index.html', import.meta.url),
  destination: new URL('marp.html', outputDirectory),
});
await mkdir(fontsOutput, { recursive: true });
for (const font of await readdir(fontsSource)) {
  if (font.endsWith('.woff2')) {
    await copyFile(new URL(font, fontsSource), new URL(font, fontsOutput));
  }
}
