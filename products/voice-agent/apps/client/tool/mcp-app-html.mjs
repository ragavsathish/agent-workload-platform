import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const bootstrap = "const theme = new URLSearchParams(location.search).get('theme'); document.documentElement.dataset.piTheme = theme === 'light' ? 'light' : 'dark';";
const hash = (source) => `sha256-${createHash('sha256').update(source).digest('base64')}`;

const replaceOnce = (source, marker, value) => {
  if (source.split(marker).length !== 2) throw new Error(`MCP App template must contain one ${marker}`);
  return source.replace(marker, () => value);
};

export const renderMcpAppHtml = (template, { script, css }) => {
  // Script data cannot close its HTML element, including parser tables that
  // contain a literal closing tag. Hash the exact bytes inserted into HTML.
  const inlineScript = script.replace(/<\/script/giu, '<\\/script');
  let html = replaceOnce(template, '__MCP_APP_BOOTSTRAP_HASH__', hash(bootstrap));
  html = replaceOnce(html, '__MCP_APP_SCRIPT_HASH__', hash(inlineScript));
  html = replaceOnce(html, '__MCP_APP_CSS__', css);
  html = replaceOnce(html, '__MCP_APP_BOOTSTRAP__', bootstrap);
  return replaceOnce(html, '__MCP_APP_SCRIPT__', inlineScript);
};

export const buildMcpAppHtml = async ({
  bundle,
  entryPoint,
  template,
  destination,
  workingDirectory = new URL('../', import.meta.url),
  nodePaths = [],
}) => {
  const result = await bundle({
    absWorkingDir: fileURLToPath(workingDirectory),
    bundle: true,
    entryPoints: [fileURLToPath(entryPoint)],
    format: 'iife',
    loader: { '.woff2': 'dataurl', '.otf': 'dataurl' },
    minify: true,
    nodePaths: nodePaths.map(fileURLToPath),
    outdir: 'mcp-app-bundle',
    target: 'es2022',
    write: false,
  });
  const script = result.outputFiles.find(({ path }) => path.endsWith('.js'))?.text;
  const css = result.outputFiles.find(({ path }) => path.endsWith('.css'))?.text;
  if (!script || !css) throw new Error('MCP App bundle must contain JavaScript and shared CSS');
  const html = renderMcpAppHtml(await readFile(template, 'utf8'), { script, css });
  await mkdir(new URL('.', destination), { recursive: true });
  await writeFile(destination, html);
};
