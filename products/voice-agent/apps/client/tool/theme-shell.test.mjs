import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const indexHtml = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const bootstrap = indexHtml.match(
  /<script id="pi-theme-bootstrap">([\s\S]*?)<\/script>/u,
);

const resolveShell = ({ preference, systemDark }) => {
  assert.ok(bootstrap, 'index.html must set the document theme before Flutter loads');
  const documentTheme = { dataset: {}, style: {} };
  const themeMeta = { content: null, setAttribute(_name, value) { this.content = value; } };
  vm.runInNewContext(bootstrap[1], {
    window: {
      localStorage: { getItem: () => preference },
      matchMedia: () => ({ matches: systemDark }),
      document: {
        documentElement: documentTheme,
        querySelector: () => themeMeta,
      },
    },
  });
  return { theme: documentTheme.dataset.piTheme ?? null, themeColor: themeMeta.content };
};

test('prepaints the saved light preference even when the OS is dark', () => {
  assert.deepEqual(resolveShell({ preference: 'light', systemDark: true }), {
    theme: 'light',
    themeColor: '#F7F9FA',
  });
});

test('prepaints the saved dark preference even when the OS is light', () => {
  assert.deepEqual(resolveShell({ preference: 'dark', systemDark: false }), {
    theme: 'dark',
    themeColor: '#080B0E',
  });
});

test('uses the OS theme when no preference is saved', () => {
  assert.deepEqual(resolveShell({ preference: null, systemDark: true }), {
    theme: null,
    themeColor: '#080B0E',
  });
  assert.deepEqual(resolveShell({ preference: null, systemDark: false }), {
    theme: null,
    themeColor: '#F7F9FA',
  });
});
