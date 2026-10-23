import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const cssPath = new URL('../design_system/tokens.css', import.meta.url);
const dartPath = new URL('../lib/design_tokens.dart', import.meta.url);
const iconCssPath = new URL('../design_system/icons.css', import.meta.url);
const iconDartPath = new URL('../lib/design_icons.dart', import.meta.url);
const before = await readFile(cssPath, 'utf8');
const dartBefore = await readFile(dartPath, 'utf8');
const iconCssBefore = await readFile(iconCssPath, 'utf8');
const iconDartBefore = await readFile(iconDartPath, 'utf8');
execFileSync('node', [new URL('./generate-design-tokens.mjs', import.meta.url).pathname]);
assert.equal(await readFile(cssPath, 'utf8'), before, 'token CSS generation must be deterministic');
assert.equal(await readFile(dartPath, 'utf8'), dartBefore, 'token Dart generation must be deterministic');
assert.equal(await readFile(iconCssPath, 'utf8'), iconCssBefore, 'icon CSS generation must be deterministic');
assert.equal(await readFile(iconDartPath, 'utf8'), iconDartBefore, 'icon Dart generation must be deterministic');
const css = await readFile(cssPath, 'utf8');
const dart = await readFile(dartPath, 'utf8');
const elements = await readFile(new URL('../design_system/elements.css', import.meta.url), 'utf8');
const font = await readFile(new URL('../design_system/fonts/SourceCodeVF-Upright.ttf.woff2', import.meta.url));
const iconCss = await readFile(iconCssPath, 'utf8');
const iconDart = await readFile(iconDartPath, 'utf8');
const iconFont = await readFile(new URL('../design_system/fonts/PiMaterialIcons.otf', import.meta.url));
const iconSource = JSON.parse(await readFile(new URL('../design_system/icons.json', import.meta.url), 'utf8'));
for (const value of ['--pi-color-canvas', '--pi-color-focus', '--pi-size-touch', '--pi-header-height', '--pi-header-mobile-height', '--pi-size-icon', '[data-pi-theme="light"]', 'prefers-reduced-motion']) assert.match(css, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(dart, /static const accent = Color\(0xFF56E39F\)/);
assert.match(dart, /static const lightCanvas = Color\(0xFFF7F9FA\)/);
assert.match(css, /Source Code Pro/);
assert.match(dart, /fontFamily = 'Source Code Pro'/);
assert.equal(font.toString('ascii', 0, 4), 'wOF2');
for (const name of ['pi-app-header', 'pi-app-header__identity', 'pi-app-header__actions', 'pi-app-header__nav', 'pi-icon', 'pi-surface', 'pi-button', 'pi-badge', 'pi-notice', 'pi-empty-state']) {
  assert.match(elements, new RegExp(`\\.${name}\\b`));
}
assert.equal(iconFont.toString('ascii', 0, 4), 'OTTO', 'bundled icon font must be a valid OpenType font');
assert.match(elements, /@import ['"]\.\/icons\.css['"]/);
for (const [name, icon] of Object.entries(iconSource.icons)) {
  const escapedCodePoint = `\u005c${icon.codePoint.slice(2)}`;
  assert.ok(iconCss.includes(`data-pi-icon='${name}']::before { content: '${escapedCodePoint}'; }`), `CSS icon mapping ${name} must match icons.json`);
  assert.ok(iconDart.includes(`static const ${name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())} = IconData(${icon.codePoint}, fontFamily: 'MaterialIcons');`), `Flutter icon mapping ${name} must match icons.json`);
}
