import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const clientDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendorDirectory = resolve(clientDirectory, '../../../../vendor/excalidraw-mcp');
const vendorRequire = createRequire(resolve(vendorDirectory, 'package.json'));
const react = (await import(pathToFileURL(vendorRequire.resolve('@vitejs/plugin-react')).href)).default;
const { viteSingleFile } = await import(
  pathToFileURL(vendorRequire.resolve('vite-plugin-singlefile')).href
);
const globalCss = resolve(vendorDirectory, 'src/global.css');

const localDependencies = {
  name: 'local-excalidraw-dependencies',
  enforce: 'pre',
  load(id) {
    if (id.split('?')[0] !== globalCss) return null;
    const css = readFileSync(globalCss, 'utf8');
    return [
      '@import "@excalidraw/excalidraw/index.css";',
      css.slice(css.indexOf('*, *::before')),
    ].join('\n');
  },
  transformIndexHtml: {
    order: 'post',
    handler(html) {
      return html
        .replace(/\s*<script type="importmap">[\s\S]*?<\/script>/u, '')
        .replace(
          '<head>',
          '<head><script>window.EXCALIDRAW_ASSET_PATH="/excalidraw/";</script>',
        );
    },
  },
};

export default {
  root: vendorDirectory,
  base: './',
  plugins: [localDependencies, react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 100_000_000,
    cssMinify: true,
    emptyOutDir: true,
    minify: true,
    outDir: resolve(clientDirectory, 'web/excalidraw'),
    rollupOptions: {
      input: resolve(vendorDirectory, 'src/mcp-app.html'),
    },
  },
};
