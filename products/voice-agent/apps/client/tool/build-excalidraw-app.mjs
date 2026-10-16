import { spawnSync } from 'node:child_process';
import { cpSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(clientDirectory, '../../../..');
const vendorDirectory = resolve(repository, 'vendor/excalidraw-mcp');
const vite = resolve(vendorDirectory, 'node_modules/.bin/vite');
const config = resolve(clientDirectory, 'tool/excalidraw-vite.config.mjs');

const result = spawnSync(vite, ['build', '--config', config], {
  cwd: vendorDirectory,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const outputDirectory = resolve(clientDirectory, 'web/excalidraw');
renameSync(
  resolve(outputDirectory, 'src/mcp-app.html'),
  resolve(outputDirectory, 'mcp-app.html'),
);
rmSync(resolve(outputDirectory, 'src'), { force: true, recursive: true });
cpSync(
  resolve(vendorDirectory, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),
  resolve(outputDirectory, 'fonts'),
  { recursive: true },
);
