import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { build } from 'esbuild';

const outputDirectory = new URL('../web/trace-explainer/', import.meta.url);
const index = new URL('../web/trace-explainer/main.html', import.meta.url);
const template = new URL('../trace_explainer_app/index.html', import.meta.url);
const htmlTemplate = await readFile(template, 'utf8');

const result = await build({
  bundle: true,
  entryPoints: [new URL('../bridge/trace_explainer_app.js', import.meta.url).pathname],
  format: 'iife',
  minify: true,
  target: 'es2022',
  write: false,
});
const script = result.outputFiles[0].text.replace(/<\/script/giu, '<\\\\/script');
const scriptHash = `sha256-${createHash('sha256').update(script).digest('base64')}`;
const html = htmlTemplate
  .replace('__MCP_APP_SCRIPT_HASH__', scriptHash)
  .replace('__MCP_APP_SCRIPT__', () => script);

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(index, html);
