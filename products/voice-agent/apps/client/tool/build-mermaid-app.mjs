import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

import { build } from 'esbuild';

const outputDirectory = new URL('../web/mermaid/', import.meta.url);
const index = new URL('../web/mermaid/index.html', import.meta.url);
const template = new URL('../mermaid_app/index.html', import.meta.url);
const htmlTemplate = await readFile(template, 'utf8');

const result = await build({
  bundle: true,
  entryPoints: [new URL('../bridge/mermaid_app.js', import.meta.url).pathname],
  format: 'iife',
  loader: { '.woff2': 'dataurl' },
  minify: true,
  outdir: 'mermaid-bundle',
  target: 'es2022',
  write: false,
});
// Inline the bundle so the app still loads inside an opaque-origin iframe.
// Escape HTML script terminators embedded in Mermaid's parser tables before
// inserting the JavaScript into the document.
const script = result.outputFiles.find(({ path }) => path.endsWith('.js')).text
  .replace(/<\/script/gi, '<\\\\/script');
const scriptHash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
const bootstrap = "document.documentElement.dataset.piTheme = new URLSearchParams(location.search).get('theme') || '';";
const bootstrapHash = `sha256-${createHash('sha256').update(bootstrap).digest('base64')}`;
const html = htmlTemplate
  .replace('__MCP_APP_BOOTSTRAP_HASH__', bootstrapHash)
  .replace('__MCP_APP_SCRIPT_HASH__', scriptHash)
  .replace('__MCP_APP_CSS__', () => result.outputFiles.find(({ path }) => path.endsWith('.css'))?.text ?? '')
  .replace('__MCP_APP_SCRIPT__', () => script);

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(index, html);
