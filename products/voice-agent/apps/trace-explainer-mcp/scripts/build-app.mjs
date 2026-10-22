import { execFileSync } from 'node:child_process';

import { build } from 'esbuild';

import { buildMcpAppHtml } from '../../client/tool/mcp-app-html.mjs';

execFileSync('node', ['../client/tool/generate-design-tokens.mjs'], { cwd: new URL('..', import.meta.url).pathname });

await buildMcpAppHtml({
  bundle: build,
  entryPoint: new URL('../../client/bridge/trace_explainer_app.js', import.meta.url),
  template: new URL('../../client/trace_explainer_app/index.html', import.meta.url),
  destination: new URL('../dist/app/main.html', import.meta.url),
  workingDirectory: new URL('../', import.meta.url),
  nodePaths: [new URL('../node_modules/', import.meta.url)],
});
