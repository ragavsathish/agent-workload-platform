import { existsSync } from "node:fs";

import {
  GondolinSession,
  type GondolinSessionOptions,
} from "@agent-workload-platform/gondolin-session";

const GUEST_WORKSPACE = "/workspace";
export const GUEST_SKILLS = "/skills";
export const GUEST_OXIGRAPH_CLI = "/opt/awp/bin";
export const GUEST_OXIGRAPH_ENDPOINT = "http://oxigraph.local:7878";
export const GUEST_S3MOCK_ENDPOINT = "http://s3mock.local:9090";
export const GUEST_GITEA_ENDPOINT = "http://gitea.local:3001";
export const GUEST_PROMETHEUS_ENDPOINT = "http://prometheus.local:9091";

export type VoiceGondolinOptions = {
  giteaEndpointUrl: string;
  giteaOwner: string;
  giteaToken: string;
  imagePath: string;
  localCwd: string;
  oxigraphCliDir: string;
  oxigraphUrl: string;
  prometheusEndpointUrl: string;
  skillsDir: string;
  s3MockAccessKey: string;
  s3MockBucket: string;
  s3MockEndpointUrl: string;
  s3MockSecretKey: string;
  sessionLabel?: string;
};

function loopbackOrigin(value: string, service: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port
    || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error(`Gondolin ${service} endpoint must be an HTTP loopback origin with an explicit port`);
  }
  return origin;
}

function guestOrigin(value: string, upstream: URL): URL {
  const guest = new URL(value);
  guest.port = upstream.port;
  return guest;
}

export function createVoiceGondolinConfig(options: VoiceGondolinOptions): GondolinSessionOptions {
  const s3Upstream = loopbackOrigin(options.s3MockEndpointUrl, "S3Mock");
  const giteaUpstream = loopbackOrigin(options.giteaEndpointUrl, "Gitea");
  const prometheusUpstream = loopbackOrigin(options.prometheusEndpointUrl, "Prometheus");
  const oxigraphUpstream = loopbackOrigin(options.oxigraphUrl, "Oxigraph");
  const routes = [
    { guest: guestOrigin(GUEST_S3MOCK_ENDPOINT, s3Upstream), upstream: s3Upstream },
    { guest: guestOrigin(GUEST_GITEA_ENDPOINT, giteaUpstream), upstream: giteaUpstream },
    { guest: guestOrigin(GUEST_PROMETHEUS_ENDPOINT, prometheusUpstream), upstream: prometheusUpstream },
    { guest: guestOrigin(GUEST_OXIGRAPH_ENDPOINT, oxigraphUpstream), upstream: oxigraphUpstream },
  ];

  return {
    imagePath: options.imagePath,
    mounts: {
      [GUEST_WORKSPACE]: options.localCwd,
      [GUEST_SKILLS]: { hostPath: options.skillsDir, readonly: true },
      [GUEST_OXIGRAPH_CLI]: { hostPath: options.oxigraphCliDir, readonly: true },
    },
    network: {
      allowedHosts: [],
      allowedInternalHosts: ["127.0.0.1"],
      onRequest: (request) => {
        const requested = new URL(request.url);
        const route = routes.find(({ guest }) =>
          requested.hostname === guest.hostname && requested.port === guest.port);
        if (!route) return new Response("network destination denied", { status: 403 });
        requested.protocol = route.upstream.protocol;
        requested.hostname = route.upstream.hostname;
        requested.port = route.upstream.port;
        return new Request(requested, request);
      },
    },
    environment: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      AWS_ACCESS_KEY_ID: options.s3MockAccessKey,
      AWS_SECRET_ACCESS_KEY: options.s3MockSecretKey,
      AWS_DEFAULT_REGION: "us-east-1",
      AWS_REGION: "us-east-1",
      S3_BUCKET: options.s3MockBucket,
      S3_ENDPOINT_URL: routes[0].guest.origin,
      GITEA_BASE_URL: routes[1].guest.origin,
      GITEA_OWNER: options.giteaOwner,
      PROMETHEUS_URL: routes[2].guest.origin,
      OXIGRAPH_URL: routes[3].guest.origin,
    },
    dns: { mode: "synthetic", syntheticHostMapping: "per-host" },
    sandbox: {
      // Gondolin 0.13's macOS/HVF resume clock sync is incompatible with the
      // sandbox helper in the deployed image: https://github.com/earendil-works/gondolin/issues/167
      qemuIdlePauseMs: 0,
    },
    startupCommands: [[
      "/usr/local/bin/tea",
      "login",
      "add",
      "--name",
      "local",
      "--url",
      routes[1].guest.origin,
      "--token",
      options.giteaToken,
      "--no-version-check",
    ]],
    memory: "2G",
    cpus: 2,
    sessionLabel: options.sessionLabel ?? "pi-voice",
  };
}

export async function createVoiceGondolinSession(
  options: VoiceGondolinOptions,
): Promise<GondolinSession> {
  if (!existsSync(options.imagePath)) {
    throw new Error(`Missing Gondolin assets: ${options.imagePath}`);
  }
  if (!existsSync(options.skillsDir)) {
    throw new Error(`Missing skills directory: ${options.skillsDir}`);
  }
  if (!existsSync(options.oxigraphCliDir)) {
    throw new Error(`Missing Oxigraph CLI directory: ${options.oxigraphCliDir}`);
  }
  const session = new GondolinSession(createVoiceGondolinConfig(options));
  await session.start();
  return session;
}
