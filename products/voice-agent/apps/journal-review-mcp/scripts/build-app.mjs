import { execFileSync } from 'node:child_process';

import { build } from 'esbuild';

import { buildMcpAppHtml } from '../../client/tool/mcp-app-html.mjs';

execFileSync('node', ['../client/tool/generate-design-tokens.mjs'], { cwd: new URL('..', import.meta.url).pathname });

await buildMcpAppHtml({
  bundle: build,
  entryPoint: new URL('../../client/bridge/journal_review_app.js', import.meta.url),
  template: new URL('../../client/journal_review_app/index.html', import.meta.url),
  destination: new URL('../dist/app/main.html', import.meta.url),
  workingDirectory: new URL('../', import.meta.url),
  nodePaths: [new URL('../node_modules/', import.meta.url)],
});

await build({
  absWorkingDir: new URL('..', import.meta.url).pathname,
  bundle: true,
  entryPoints: ['dist/main.js'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  format: 'esm',
  outfile: 'dist/stdio-bundle.mjs',
  platform: 'node',
  target: 'node22',
});
