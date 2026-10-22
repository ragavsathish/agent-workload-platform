import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';

execFileSync('node', ['../client/tool/generate-design-tokens.mjs'], { cwd: new URL('..', import.meta.url).pathname });

const destinationDirectory = new URL('../dist/app/', import.meta.url);
const destination = new URL('main.html', destinationDirectory);
const template = new URL('../../client/trace_explainer_app/index.html', import.meta.url);
const entryPoint = new URL('../../client/bridge/trace_explainer_app.js', import.meta.url);
const htmlTemplate = await readFile(template, 'utf8');
const result = await build({
  absWorkingDir: new URL('..', import.meta.url).pathname,
  bundle: true,
  entryPoints: [entryPoint.pathname],
  format: 'iife',
  loader: { '.woff2': 'dataurl' },
  minify: true,
  nodePaths: [new URL('../node_modules/', import.meta.url).pathname],
  outdir: 'trace-explainer-bundle',
  target: 'es2022',
  write: false,
});
const script = result.outputFiles.find(({ path }) => path.endsWith('.js')).text.replace(/<\/script/giu, '<\\\\/script');
const scriptHash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
const bootstrap = "document.documentElement.dataset.piTheme = new URLSearchParams(location.search).get('theme') || '';";
const bootstrapHash = `sha256-${createHash('sha256').update(bootstrap).digest('base64')}`;
const html = htmlTemplate
  .replace('__MCP_APP_BOOTSTRAP_HASH__', bootstrapHash)
  .replace('__MCP_APP_SCRIPT_HASH__', scriptHash)
  .replace('__MCP_APP_CSS__', () => result.outputFiles.find(({ path }) => path.endsWith('.css'))?.text ?? '')
  .replace('__MCP_APP_SCRIPT__', () => script);

await mkdir(destinationDirectory, { recursive: true });
await writeFile(destination, html);
