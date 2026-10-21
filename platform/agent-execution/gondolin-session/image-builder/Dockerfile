# syntax=docker/dockerfile:1.7

FROM docker.io/gitea/runner:4.1.0@sha256:131ff842ec12453108f1c1a454031c325d3c95e4af459979a2e303e12d99c98c AS gitea-runner

FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0

ARG BABASHKA_VERSION=1.13.219

COPY --from=gitea-runner /usr/local/bin/gitea-runner /usr/local/bin/gitea-runner

RUN apk add --no-cache \
      bash=5.3.3-r1 \
      ca-certificates=20261020-r0 \
      containerd=2.2.0-r8 \
      docker=29.5.2-r0 \
      docker-cli=29.5.2-r0 \
      e2fsprogs=1.47.3-r0 \
      e2fsprogs-extra=1.47.3-r0 \
      git=2.52.0-r0 \
      gcompat=1.1.0-r4 \
      cpio=2.15-r0 \
      lz4=1.10.0-r0 \
      nodejs=24.18.1-r0 \
      npm=11.11.0-r0 \
      tar=1.35-r4 \
      xz=5.8.4-r0 \
      zig=0.15.2-r0

RUN case "$(apk --print-arch)" in \
      aarch64) bb_arch=aarch64; bb_sha=e8d7a9c66c364b80627a43cb6ba5c14fb6ac7e4af114e8e5d80f97551ccdfe11; compose_arch=aarch64; compose_sha=733ec76717ceb59052a9609b9dadfb523b2df8eab57a54212872d10a58078ea2 ;; \
      x86_64) bb_arch=amd64; bb_sha=9ac1fe988d7001625b30ef3e3307e67f8545505a7cb49a4aa179f578115a3e09; compose_arch=x86_64; compose_sha=40343e21ca777173e69cff5dbafeb37c6f81f3b0d57d9e597f036e95eb63e76a ;; \
      *) exit 1 ;; \
    esac \
    && mkdir -p /usr/local/libexec/docker/cli-plugins \
    && node --input-type=module -e 'import fs from "node:fs/promises"; const [url, file] = process.argv.slice(1); const response = await fetch(url); if (!response.ok) throw new Error(`download failed: ${response.status}`); await fs.writeFile(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });' \
      "https://github.com/babashka/babashka/releases/download/v${BABASHKA_VERSION}/babashka-${BABASHKA_VERSION}-linux-${bb_arch}-static.tar.gz" \
      /tmp/babashka.tar.gz \
    && echo "${bb_sha}  /tmp/babashka.tar.gz" | sha256sum -c \
    && tar -xzf /tmp/babashka.tar.gz -C /usr/local/bin bb \
    && chmod 0555 /usr/local/bin/bb \
    && rm /tmp/babashka.tar.gz \
    && node --input-type=module -e 'import fs from "node:fs/promises"; const [url, file] = process.argv.slice(1); const response = await fetch(url); if (!response.ok) throw new Error(`download failed: ${response.status}`); await fs.writeFile(file, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });' \
      "https://github.com/docker/compose/releases/download/v5.6.0/docker-compose-linux-${compose_arch}" \
      /usr/local/libexec/docker/cli-plugins/docker-compose \
    && echo "${compose_sha}  /usr/local/libexec/docker/cli-plugins/docker-compose" | sha256sum -c \
    && chmod 0555 /usr/local/libexec/docker/cli-plugins/docker-compose \
    && docker compose version
