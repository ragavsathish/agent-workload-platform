import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { packOracle, readOracle, validateHarnessSpec } from './measurement-oracle-oci.mjs';

test('harness spec requires stable, unique scenario IDs', () => {
  assert.throws(() => validateHarnessSpec(Buffer.from('Feature: X\nScenario: no id\n')),
    /needs one stable harness id/u);
});

test('OCI oracle round trips and rejects a modified golden blob', async () => {
  const work = await mkdtemp(join(tmpdir(), 'awp-oracle-oci-test-'));
  const layout = join(work, 'candidate.oci');
  const golden = { schema: 1, cases: [{ fullName: 'synthetic.case', status: 'passed' }] };
  try {
    const digest = await packOracle(golden, layout);
    assert.equal((await readOracle(layout)).digest, digest);
    assert.deepEqual((await readOracle(layout)).golden, golden);
    await assert.rejects(packOracle(golden, layout), { code: 'EEXIST' });
    const differentSpec = join(work, 'different.feature');
    await writeFile(differentSpec, 'Feature: changed\n');
    await assert.rejects(readOracle(layout, differentSpec), /packaged harness spec differs from source/u);
    const index = JSON.parse(await readFile(join(layout, 'index.json'), 'utf8'));
    const manifestPath = join(layout, 'blobs', 'sha256', index.manifests[0].digest.slice(7));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const specPath = join(layout, 'blobs', 'sha256', manifest.layers[1].digest.slice(7));
    const specBytes = await readFile(specPath);
    const tamperedSpec = Buffer.from(specBytes);
    tamperedSpec[0] ^= 1;
    await writeFile(specPath, tamperedSpec);
    await assert.rejects(readOracle(layout), /OCI blob digest mismatch/u);
    await writeFile(specPath, specBytes);
    const goldenPath = join(layout, 'blobs', 'sha256', manifest.layers[0].digest.slice(7));
    const bytes = await readFile(goldenPath);
    bytes[bytes.length - 2] ^= 1;
    await writeFile(goldenPath, bytes);
    await assert.rejects(readOracle(layout), /OCI blob digest mismatch/u);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
