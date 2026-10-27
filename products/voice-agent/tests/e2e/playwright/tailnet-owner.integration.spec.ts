import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as allure from 'allure-js-commons';
import { test, expect } from '@playwright/test';

const voiceRoot = resolve(process.cwd(), '../..');
const compose = ['compose', '--env-file', 'deploy/.env', '-f', 'deploy/compose.yml',
  'exec', '-T', 'traefik', '/usr/bin/wget', '-qS', '-O', '/dev/null'];
const curlImage = 'curlimages/curl:8.16.0@sha256:463eaf6072688fe96ac64fa623fe73e1dbe25d8ad6c34404a669ad3ce1f104b6';

function ownerLogin(): string {
  const env = readFileSync(resolve(voiceRoot, 'apps/edge/.env'), 'utf8');
  const value = env.match(/^EDGE_ALLOWED_USERS=(.+)$/mu)?.[1]?.trim().replace(/^['"]|['"]$/gu, '');
  if (!value) throw new Error('EDGE_ALLOWED_USERS is missing from the deployed edge configuration');
  return value.split(',')[0].trim().toLowerCase();
}

function ingressStatus(identity: string, path: string, query = false): number {
  const args = [...compose];
  if (identity) args.push('--header', `Tailscale-User-Login: ${identity}`);
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

function curlStatus(args: string[]): number {
  const response = spawnSync('docker', ['run', '--rm', ...args], { encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
  if (response.error || response.status !== 0) {
    throw new Error(`Gitea ingress probe failed: ${response.stderr?.slice(-500)}`);
  }
  const code = Number(response.stdout.trim());
  if (!Number.isInteger(code)) throw new Error(`Invalid Gitea ingress status: ${response.stdout}`);
  return code;
}

function giteaSocketStatus(identity: string, path: string, forgedUser = false): number {
  const headers = ['-H', `Tailscale-User-Login: ${identity}`];
  if (forgedUser) headers.push('-H', 'X-WEBAUTH-USER: tailnet-admin');
  return curlStatus(['--volumes-from', 'pipecat-mlx-voice-gitea-ingress-1',
    curlImage, '-sS', '-o', '/dev/null', '-w', '%{http_code}',
    '--unix-socket', '/run/gitea-ingress/gitea.sock', ...headers,
    `http://localhost${path}`]);
}

function giteaTailnetStatus(path: string): number {
  const status = spawnSync('docker', ['compose', '--env-file', 'deploy/.env', '-f', 'deploy/compose.yml',
    'exec', '-T', 'tailscale', 'tailscale', 'status', '--json'], {
    cwd: voiceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000,
  });
  if (status.error || status.status !== 0) throw new Error('Cannot read Tailscale status');
  const self = JSON.parse(status.stdout).Self;
  const dns = String(self.DNSName).replace(/\.$/u, '');
  const ip = self.TailscaleIPs.find((value: string) => value.includes('.'));
  return curlStatus(['--network', 'container:pipecat-mlx-voice-tailscale-1',
    curlImage, '-sS', '-o', '/dev/null', '-w', '%{http_code}',
    '--resolve', `${dns}:443:${ip}`, `https://${dns}${path}`]);
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

test('Tailscale owner reaches Gitea admin and direct header forgery fails', async ({}, testInfo) => {
  const evidence: Record<string, number> = {};
  await allure.step('Given Gitea is isolated behind the Tailscale-only socket', async () => {
    const inspected = spawnSync('docker', ['inspect', 'pipecat-mlx-voice-gitea-1',
      'pipecat-mlx-voice-gitea-ingress-1', 'pipecat-mlx-voice-tailscale-1',
      'pipecat-mlx-voice-voice-edge-1'], { encoding: 'utf8', timeout: 15_000 });
    if (inspected.error || inspected.status !== 0) throw new Error('Cannot inspect Gitea isolation');
    const [gitea, proxy, tailscale, edge] = JSON.parse(inspected.stdout);
    expect(Object.keys(gitea.NetworkSettings.Networks)).toEqual(['pipecat-mlx-voice_gitea-backend']);
    const hasSocket = (container: { Mounts: Array<{ Destination: string }> }) =>
      container.Mounts.some((mount) => mount.Destination === '/run/gitea-ingress');
    expect(hasSocket(proxy)).toBe(true);
    expect(hasSocket(tailscale)).toBe(true);
    expect(hasSocket(edge)).toBe(false);
    evidence.socketOwner = giteaSocketStatus(ownerLogin(), '/-/admin');
    expect(evidence.socketOwner).toBe(200);
  });
  await allure.step('When another identity forges a Gitea login header', async () => {
    evidence.socketOther = giteaSocketStatus('other@example.invalid', '/-/admin', true);
    const direct = await fetch('http://127.0.0.1:3001/-/admin', {
      headers: { 'X-WEBAUTH-USER': 'tailnet-admin', 'Tailscale-User-Login': ownerLogin() },
      redirect: 'manual',
    });
    evidence.directForged = direct.status;
  });
  await allure.step('Then only the Tailscale owner reaches admin through Serve', async () => {
    expect(evidence.socketOther).toBe(303);
    expect(evidence.directForged).toBe(303);
    evidence.tailnetAdmin = giteaTailnetStatus('/git/-/admin');
    evidence.publicNops = giteaTailnetStatus('/git/source-publisher/nops');
    expect(evidence.tailnetAdmin).toBe(200);
    expect(evidence.publicNops).toBe(200);
  });
  await testInfo.attach('tailnet-gitea-admin-statuses', {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: 'application/json',
  });
});
