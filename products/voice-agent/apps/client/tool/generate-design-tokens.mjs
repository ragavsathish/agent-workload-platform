import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const input = JSON.parse(await readFile(new URL('design_system/tokens.json', root), 'utf8'));
const icons = JSON.parse(await readFile(new URL('design_system/icons.json', root), 'utf8'));
const cssFor = (theme) => Object.entries(theme.color).map(([name, value]) => `  --pi-color-${name.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)}: ${value};`).join('\n');
const commonCss = (section, prefix) => Object.entries(section).map(([name, value]) => `  --pi-${prefix}-${name}: ${value};`).join('\n');
const css = `/* Generated from design_system/tokens.json; do not edit. v${input.version} */
:root, [data-pi-theme="dark"] {
  color-scheme: dark;
${cssFor(input.themes.dark)}
  --pi-shadow-raised: ${input.themes.dark.shadow};
${commonCss(input.space, 'space')}
${commonCss(input.radius, 'radius')}
${commonCss(input.type, 'font')}
${commonCss(input.size, 'size')}
${commonCss(input.header, 'header')}
${commonCss(input.motion, 'motion')}
}
[data-pi-theme="light"] { color-scheme: light;
${cssFor(input.themes.light)}
  --pi-shadow-raised: ${input.themes.light.shadow};
}
@media (prefers-color-scheme: light) { :root:not([data-pi-theme]) { color-scheme: light;
${cssFor(input.themes.light)}
  --pi-shadow-raised: ${input.themes.light.shadow};
} }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 1ms !important; } }
`;
const dartColor = (hex) => `Color(0xFF${hex.slice(1)})`;
const dartNumber = (value) => Number.parseFloat(value).toFixed(1);
const dark = input.themes.dark.color;
const light = input.themes.light.color;
const dartPalette = (prefix, colors) => Object.entries(colors)
  .map(([name, value]) => `  static const ${prefix}${name[0].toUpperCase()}${name.slice(1)} = ${dartColor(value)};`)
  .join('\n');
const dart = `// Generated from design_system/tokens.json; do not edit. v${input.version}
import 'package:flutter/material.dart';

abstract final class PiDesignTokens {
  static const version = '${input.version}';
  static const fontFamily = 'Source Code Pro';
  static const canvas = ${dartColor(dark.canvas)};
  static const surface = ${dartColor(dark.surface)};
  static const surfaceRaised = ${dartColor(dark.surfaceRaised)};
  static const border = ${dartColor(dark.border)};
  static const borderStrong = ${dartColor(dark.borderStrong)};
  static const text = ${dartColor(dark.text)};
  static const textMuted = ${dartColor(dark.textMuted)};
  static const accent = ${dartColor(dark.accent)};
  static const accentStrong = ${dartColor(dark.accentStrong)};
  static const accentText = ${dartColor(dark.accentText)};
  static const info = ${dartColor(dark.info)};
  static const warning = ${dartColor(dark.warning)};
  static const danger = ${dartColor(dark.danger)};
  static const focus = ${dartColor(dark.focus)};
${dartPalette('light', light)}
  static const space1 = 4.0,
      space2 = 8.0,
      space3 = 12.0,
      space4 = 16.0,
      space5 = 20.0,
      space6 = 24.0;
  static const radiusSm = 6.0, radiusMd = 9.0, radiusLg = 14.0;
  static const touchTarget = ${dartNumber(input.size.touch)}, iconSize = ${dartNumber(input.size.icon)};
  static const headerHeight = ${dartNumber(input.header.height)}, headerMobileHeight = ${dartNumber(input.header['mobile-height'])};
  static const headerPaddingInline = ${dartNumber(input.header['padding-inline'])}, headerMobilePaddingInline = ${dartNumber(input.header['mobile-padding-inline'])};
  static const headerMark = ${dartNumber(input.header.mark)}, headerGap = ${dartNumber(input.header.gap)};
}
`;
const kebabToCamel = (value) => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
const iconCss = `/* Generated from design_system/icons.json; do not edit. v${icons.version} */
@font-face {
  font-family: 'Pi Material Icons';
  src: url('./fonts/PiMaterialIcons.otf') format('opentype');
  font-style: normal;
  font-weight: 400;
  font-display: block;
}
.pi-icon { display: inline-grid; flex: none; width: var(--pi-size-icon); height: var(--pi-size-icon); place-items: center; font-family: 'Pi Material Icons'; font-size: var(--pi-size-icon); font-style: normal; font-weight: 400; line-height: 1; font-feature-settings: 'liga'; -webkit-font-smoothing: antialiased; }
${Object.entries(icons.icons).map(([name, icon]) => `.pi-icon[data-pi-icon='${name}']::before { content: '\\${icon.codePoint.slice(2)}'; }`).join('\n')}
.pi-icon svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
`;
const iconDart = `// Generated from design_system/icons.json; do not edit. v${icons.version}
import 'package:flutter/widgets.dart';

abstract final class PiHeaderIcons {
${Object.entries(icons.icons).map(([name, icon]) => `  static const ${kebabToCamel(name)} = IconData(${icon.codePoint}, fontFamily: 'MaterialIcons');`).join('\n')}
}
`;
await writeFile(new URL('design_system/tokens.css', root), css);
await writeFile(new URL('lib/design_tokens.dart', root), dart);
await writeFile(new URL('design_system/icons.css', root), iconCss);
await writeFile(new URL('lib/design_icons.dart', root), iconDart);
