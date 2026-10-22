import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { renderMcpAppHtml } from './mcp-app-html.mjs';

const template = '<meta content="script-src \'__MCP_APP_BOOTSTRAP_HASH__\' \'__MCP_APP_SCRIPT_HASH__\'"><style>__MCP_APP_CSS__</style><script>__MCP_APP_BOOTSTRAP__</script><script id="app">__MCP_APP_SCRIPT__</script>';
const digest = (value) => `sha256-${createHash('sha256').update(value).digest('base64')}`;

test('inline app scripts are escaped and CSP hashes match inserted bytes', () => {
  const html = renderMcpAppHtml(template, {
    script: 'const closingTag = "</script>";',
    css: '.pi-button{color:red}',
  });
  const scripts = [...html.matchAll(/<script(?: id="app")?>([\s\S]*?)<\/script>/gu)].map((match) => match[1]);
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /<\\\/script>/u);
  assert.match(html, /\.pi-button\{color:red\}/u);
  assert.ok(html.includes(digest(scripts[0])));
  assert.ok(html.includes(digest(scripts[1])));
});

test('templates missing a CSP placeholder fail the build', () => {
  assert.throws(
    () => renderMcpAppHtml(template.replace('__MCP_APP_SCRIPT_HASH__', ''), { script: 'ok', css: 'ok' }),
    /must contain one __MCP_APP_SCRIPT_HASH__/u,
  );
});
