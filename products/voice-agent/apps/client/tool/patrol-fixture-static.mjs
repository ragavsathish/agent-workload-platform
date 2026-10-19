import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const mimeTypes = Object.freeze({
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

export const staticPath = (root, pathname) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const target = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  const withinRoot = relative(root, target);
  return withinRoot === '..' || withinRoot.startsWith(`..${sep}`) ? null : target;
};

export const serveStatic = async (response, root, pathname) => {
  const path = staticPath(root, pathname);
  if (!path) return false;
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return false;
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': metadata.size,
      'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(path).pipe(response);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
};
