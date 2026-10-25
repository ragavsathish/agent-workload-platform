import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as allure from 'allure-js-commons';
import { test, expect } from '@playwright/test';

const voiceRoot = resolve(process.cwd(), '../..');
const compose = ['compose', '--env-file', 'deploy/.env', '-f', 'deploy/compose.yml',
  'exec', '-T', 'traefik', '/usr/bin/wget', '-qS', '-O', '/dev/null'];

function ownerLogin(): string {
  const env = readFileSync(resolve(voiceRoot, 'apps/edge/.env'), 'utf8');
  const value = env.match(/^EDGE_ALLOWED_USERS=(.+)$/mu)?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
  if (!value) throw new Error('EDGE_ALLOWED_USERS is missing from the deployed edge configuration');
  return value.split(',')[0].trim().toLowerCase();
}

function ingressStatus(identity: string, path: string, query = false): number {
  const args = [...compose, '--header', `Tailscale-User-Login: ${identity}`];
  if (query) args.push('--header', 'Content-Type: application/sparql-query',
    '--post-data', 'SELECT * WHERE { ?s ?p ?o } LIMIT 1');
  args.push(`http://127.0.0.1:8080${path}`);
  const response = spawnSync('docker', args, { cwd: voiceRoot, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
  const output = `${response.stdout ?? ''}${response.stderr ?? ''}`;
  if (response.error) throw response.error;
  const codes = [...output.matchAll(/HTTP\/1\.[01] (\d{3})/gu)].map((match) => Number(match[1]));
  if (!codes.length) throw new Error(`Traefik returned no HTTP status for ${path}: ${output.slice(-1000)}`);
  return codes.at(-1)!;
}

test('tailnet routes reject another user before reaching Grafana or Oxigraph', async ({}, testInfo) => {
  const evidence: Record<string, number> = {};
  await allure.step('Given the deployed tailnet router and configured exact owner', async () => {
    expect(ownerLogin()).not.toBe('other@example.invalid');
  });
  await allure.step('When another identity requests protected routes', async () => {
    evidence.metricsOtherUser = ingressStatus('other@example.invalid', '/metrics/');
    evidence.graphOtherUser = ingressStatus('other@example.invalid', '/oxigraph/query', true);
  });
  await allure.step('Then Traefik denies both requests before the backing services respond', async () => {
    expect(evidence.metricsOtherUser).toBe(403);
    expect(evidence.graphOtherUser).toBe(403);
  });
  await allure.step('And the configured owner can still query the graph', async () => {
    evidence.graphOwner = ingressStatus(ownerLogin(), '/oxigraph/query', true);
    expect(evidence.graphOwner).toBe(200);
  });
  await testInfo.attach('tailnet-owner-statuses', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
});
