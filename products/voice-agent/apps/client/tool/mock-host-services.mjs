import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const staticRoot = join(clientRoot, 'build', 'web');
try {
  await access(join(staticRoot, 'index.html'));
} catch {
  console.error('Build the client first: npm run build');
  process.exit(1);
}

process.env.PATROL_FIXTURE_PORT = process.env.MOCK_HOST_PORT ?? '8766';
process.env.PATROL_FIXTURE_HOST = process.env.MOCK_HOST_BIND ?? '127.0.0.1';
process.env.PATROL_FIXTURE_NAME = 'voice-host-services-mock';
process.env.PATROL_FIXTURE_STATIC_ROOT = staticRoot;
await import('./patrol-fixture-server.mjs');
