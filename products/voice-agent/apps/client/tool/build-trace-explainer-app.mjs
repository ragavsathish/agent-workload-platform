import { rm } from 'node:fs/promises';

import { build } from 'esbuild';

import { buildMcpAppHtml } from './mcp-app-html.mjs';

const outputDirectory = new URL('../web/trace-explainer/', import.meta.url);
await rm(outputDirectory, { force: true, recursive: true });
await buildMcpAppHtml({
  bundle: build,
  entryPoint: new URL('../bridge/trace_explainer_app.js', import.meta.url),
  template: new URL('../trace_explainer_app/index.html', import.meta.url),
  destination: new URL('main.html', outputDirectory),
});
