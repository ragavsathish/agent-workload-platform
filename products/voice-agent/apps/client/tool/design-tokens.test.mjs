import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const cssPath = new URL('../design_system/tokens.css', import.meta.url);
const dartPath = new URL('../lib/design_tokens.dart', import.meta.url);
const before = await readFile(cssPath, 'utf8');
const dartBefore = await readFile(dartPath, 'utf8');
execFileSync('node', [new URL('./generate-design-tokens.mjs', import.meta.url).pathname]);
assert.equal(await readFile(cssPath, 'utf8'), before, 'token CSS generation must be deterministic');
assert.equal(await readFile(dartPath, 'utf8'), dartBefore, 'token Dart generation must be deterministic');
const css = await readFile(cssPath, 'utf8');
const dart = await readFile(dartPath, 'utf8');
const elements = await readFile(new URL('../design_system/elements.css', import.meta.url), 'utf8');
const font = await readFile(new URL('../design_system/fonts/SourceCodeVF-Upright.ttf.woff2', import.meta.url));
for (const value of ['--pi-color-canvas', '--pi-color-focus', '--pi-size-touch', '[data-pi-theme="light"]', 'prefers-reduced-motion']) assert.match(css, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(dart, /static const accent = Color\(0xFF56E39F\)/);
assert.match(css, /Source Code Pro/);
assert.match(dart, /fontFamily = 'Source Code Pro'/);
assert.equal(font.toString('ascii', 0, 4), 'wOF2');
for (const name of ['pi-surface', 'pi-button', 'pi-badge', 'pi-notice', 'pi-empty-state']) {
  assert.match(elements, new RegExp(`\\.${name}\\b`));
}
