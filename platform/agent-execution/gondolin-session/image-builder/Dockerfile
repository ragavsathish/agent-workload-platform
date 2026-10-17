# syntax=docker/dockerfile:1.7

FROM docker.io/gitea/runner:4.1.0@sha256:131ff842ec12453108f1c1a454031c325d3c95e4af459979a2e303e12d99c98c AS gitea-runner

FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0

COPY --from=gitea-runner /usr/local/bin/gitea-runner /usr/local/bin/gitea-runner

RUN apk add --no-cache \
      bash=5.3.3-r1 \
      ca-certificates=20260909-r0 \
      containerd=2.2.0-r8 \
      docker=29.5.2-r0 \
      docker-cli=29.5.2-r0 \
      e2fsprogs=1.47.3-r0 \
      e2fsprogs-extra=1.47.3-r0 \
      git=2.52.0-r0 \
      cpio=2.15-r0 \
      lz4=1.10.0-r0 \
      nodejs=24.18.1-r0 \
      npm=11.11.0-r0 \
      tar=1.35-r4 \
      xz=5.8.4-r0 \
      zig=0.15.2-r0
