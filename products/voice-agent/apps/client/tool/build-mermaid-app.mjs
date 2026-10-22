import { rm } from 'node:fs/promises';

import { build } from 'esbuild';

import { buildMcpAppHtml } from './mcp-app-html.mjs';

const outputDirectory = new URL('../web/mermaid/', import.meta.url);
await rm(outputDirectory, { force: true, recursive: true });
await buildMcpAppHtml({
  bundle: build,
  entryPoint: new URL('../bridge/mermaid_app.js', import.meta.url),
  template: new URL('../mermaid_app/index.html', import.meta.url),
  destination: new URL('index.html', outputDirectory),
});
