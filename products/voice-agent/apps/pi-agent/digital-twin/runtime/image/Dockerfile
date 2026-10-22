# syntax=docker/dockerfile:1.7

FROM alpine:3.23@sha256:85fe1e81d6758c208f3e1eed4338a1997e19d4be002d4dd32d3100c9a8c010a0

RUN --mount=type=secret,id=gondolin_mitm_ca,required=false \
    apk add --no-cache \
      ca-certificates \
      nodejs=24.18.1-r0 \
    && if [ -f /run/secrets/gondolin_mitm_ca ]; then \
         install -m 0644 /run/secrets/gondolin_mitm_ca \
           /usr/local/share/ca-certificates/gondolin-mitm.crt; \
         update-ca-certificates; \
       fi

WORKDIR /app
COPY processor.mjs /app/processor.mjs
COPY prompts /app/prompts

USER 65532:65532
ENTRYPOINT ["node", "/app/processor.mjs"]
