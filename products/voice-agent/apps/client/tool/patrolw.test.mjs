import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = dirname(fileURLToPath(import.meta.url));

test('patrol wrapper fetches the pinned runner before applying its trace patch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'patrolw-bootstrap-'));
  try {
    const tool = join(root, 'tool');
    const cache = join(root, 'guest-pub-cache');
    const patrol = join(cache, 'bin', 'patrol');
    const runner = join(cache, 'hosted', 'pub.dev', 'patrol-4.10.0', 'web_runner', 'tests', 'test.spec.ts');
    await mkdir(tool, { recursive: true });
    await mkdir(dirname(patrol), { recursive: true });
    await copyFile(join(source, 'patrolw'), join(tool, 'patrolw'));
    await copyFile(join(source, 'patch-patrol-web-trace.clj'), join(tool, 'patch-patrol-web-trace.clj'));
    await writeFile(patrol, `#!/bin/sh\n# ${cache}\necho patrol_cli 4.8.0\n`);
    await chmod(patrol, 0o755);
    await writeFile(join(tool, 'flutterw'), `#!/bin/sh
set -eu
if [ "$1" = pub ] && [ "$2" = get ]; then
  mkdir -p "${dirname(runner)}"
  cat > "${runner}" <<'RUNNER'
  page: async ({ page, context }, use, testInfo) => {
    for (const p of context.pages()) {
      if (p !== page && !p.isClosed()) {
        await p.close().catch(() => {})
      }
    }
RUNNER
  exit 0
fi
exit 9
`);
    await chmod(join(tool, 'flutterw'), 0o755);

    const result = spawnSync('bash', [join(tool, 'patrolw'), '--version'], {
      cwd: root,
      env: { ...process.env, PATH: `/tmp:${process.env.PATH}`, FLUTTER_BIN: '/bin/true', PUB_CACHE: cache },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(runner, 'utf8'), /context\.tracing\.start/u);
    assert.match(await readFile(runner, 'utf8'), /context\.tracing\.stop/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
