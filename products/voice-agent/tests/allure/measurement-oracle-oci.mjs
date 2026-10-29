#!/usr/bin/env node
// OCI image-layout storage for the accepted, synthetic measurement projection.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const oracleLayout = join(here, 'measurement-oracle.oci');
export const harnessSpec = resolve(here, '../../../..', 'harness/spec.feature');
const indexType = 'application/vnd.oci.image.index.v1+json';
const manifestType = 'application/vnd.oci.image.manifest.v1+json';
const emptyType = 'application/vnd.oci.empty.v1+json';
const artifactType = 'application/vnd.agent-workload-platform.measurement-oracle.v1+json';
const goldenType = 'application/vnd.agent-workload-platform.measurement-oracle.golden.v1+json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const descriptor = (bytes, mediaType) => ({ mediaType, digest: `sha256:${sha256(bytes)}`, size: bytes.length });

export function validateHarnessSpec(bytes) {
  const lines = bytes.toString('utf8').split(/\r?\n/u);
  const ids = [];
  for (const [index, line] of lines.entries()) {
    if (!/^\s*Scenario(?: Outline)?:/u.test(line)) continue;
    const tag = lines[index - 1]?.trim() ?? '';
    assert.match(tag, /^@harness-\d{3}$/u, `scenario at line ${index + 1} needs one stable harness id`);
    ids.push(tag);
  }
  assert.equal(ids.length, 18, 'harness scenario denominator changed; review the oracle coverage');
  assert.equal(new Set(ids).size, ids.length, 'duplicate harness scenario id');
  assert.deepEqual(ids, ids.map((_, index) => `@harness-${String(index + 1).padStart(3, '0')}`),
    'harness ids must remain ordered and append-only');
}

async function readBlob(root, entry) {
  assert.match(entry.digest, /^sha256:[0-9a-f]{64}$/u, 'invalid OCI digest');
  const bytes = await readFile(join(root, 'blobs', 'sha256', entry.digest.slice(7)));
  assert.equal(bytes.length, entry.size, `OCI blob size mismatch: ${entry.digest}`);
  assert.equal(`sha256:${sha256(bytes)}`, entry.digest, `OCI blob digest mismatch: ${entry.digest}`);
  return bytes;
}

export async function readOracle(root = oracleLayout, specPath = harnessSpec) {
  const layout = JSON.parse(await readFile(join(root, 'oci-layout'), 'utf8'));
  assert.equal(layout.imageLayoutVersion, '1.0.0');
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.mediaType, indexType);
  assert.equal(index.manifests.length, 1);
  const manifestRef = index.manifests[0];
  assert.equal(manifestRef.mediaType, manifestType);
  assert.equal(manifestRef.annotations?.['org.opencontainers.image.ref.name'], 'measurement-oracle-v1');
  const manifest = JSON.parse(await readBlob(root, manifestRef));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.mediaType, manifestType);
  assert.equal(manifest.artifactType, artifactType);
  assert.equal(manifest.config.mediaType, emptyType);
  assert.equal((await readBlob(root, manifest.config)).toString(), '{}');
  assert.equal(manifest.layers.length, 2);
  assert.equal(manifest.layers[0].mediaType, goldenType);
  assert.equal(manifest.layers[0].annotations?.['org.opencontainers.image.title'], 'measurement-oracle.golden.json');
  assert.equal(manifest.layers[1].mediaType, 'text/plain');
  assert.equal(manifest.layers[1].annotations?.['org.opencontainers.image.title'], 'harness/spec.feature');
  const packagedSpec = await readBlob(root, manifest.layers[1]);
  validateHarnessSpec(packagedSpec);
  assert.deepEqual(packagedSpec, await readFile(specPath), 'packaged harness spec differs from source');
  const golden = JSON.parse(await readBlob(root, manifest.layers[0]));
  assert.equal(golden.schema, 1);
  assert.ok(Array.isArray(golden.cases) && golden.cases.length > 0, 'empty oracle projection');
  return { golden, digest: manifestRef.digest };
}

export async function packOracle(golden, root, specPath = harnessSpec) {
  assert.equal(golden.schema, 1);
  assert.ok(Array.isArray(golden.cases) && golden.cases.length > 0, 'empty oracle projection');
  const specBytes = await readFile(specPath);
  validateHarnessSpec(specBytes);
  await mkdir(root); // An accepted layout must never be overwritten by a candidate command.
  await mkdir(join(root, 'blobs', 'sha256'), { recursive: true });
  const add = async (bytes, mediaType) => {
    const entry = descriptor(bytes, mediaType);
    await writeFile(join(root, 'blobs', 'sha256', entry.digest.slice(7)), bytes, { flag: 'wx' });
    return entry;
  };
  const config = await add(Buffer.from('{}'), emptyType);
  const layer = { ...await add(jsonBytes(golden), goldenType),
    annotations: { 'org.opencontainers.image.title': 'measurement-oracle.golden.json' } };
  const specLayer = { ...await add(specBytes, 'text/plain'),
    annotations: { 'org.opencontainers.image.title': 'harness/spec.feature' } };
  const manifest = {
    schemaVersion: 2, mediaType: manifestType, artifactType,
    config, layers: [layer, specLayer],
  };
  const manifestRef = { ...await add(jsonBytes(manifest), manifestType),
    annotations: { 'org.opencontainers.image.ref.name': 'measurement-oracle-v1' } };
  await writeFile(join(root, 'oci-layout'), jsonBytes({ imageLayoutVersion: '1.0.0' }));
  await writeFile(join(root, 'index.json'), jsonBytes({ schemaVersion: 2, mediaType: indexType,
    manifests: [manifestRef] }));
  return manifestRef.digest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, input, output] = process.argv.slice(2);
  try {
    if (command === 'pack' && input && output) {
      const golden = JSON.parse(await readFile(input, 'utf8'));
      const digest = await packOracle(golden, resolve(output));
      const readback = await readOracle(resolve(output));
      assert.deepEqual(readback.golden, golden);
      console.log(digest);
    } else if (command === 'inspect' && input && !output) {
      const { golden, digest } = await readOracle(resolve(input));
      console.log(JSON.stringify({ digest, cases: golden.cases.length, schema: golden.schema }));
    } else {
      throw new Error('usage: node measurement-oracle-oci.mjs pack <candidate.json> <new-layout-dir> | inspect <layout-dir>');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
