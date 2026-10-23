import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const input = JSON.parse(await readFile(new URL('design_system/tokens.json', root), 'utf8'));
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
  static const touchTarget = 44.0;
}
`;
await writeFile(new URL('design_system/tokens.css', root), css);
await writeFile(new URL('lib/design_tokens.dart', root), dart);
