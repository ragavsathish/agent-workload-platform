FROM docker.io/library/node@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

LABEL io.pipecat.trace-render-worker="true"

ENV HOME=/tmp \
    NODE_ENV=production \
    PLAYWRIGHT_TRACE_OUTPUT_ROOT=/scratch

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 65532 app \
    && useradd --uid 65532 --gid 65532 --no-create-home app

WORKDIR /app
COPY apps/trace-render-worker/package.json apps/trace-render-worker/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps/trace-render-worker/server.mjs ./server.mjs
COPY apps/trace-render-worker/telemetry.mjs ./telemetry.mjs
COPY apps/client/tool/prototype-trace-explainer.mjs ./tool/prototype-trace-explainer.mjs
COPY apps/client/tool/trace-explainer-analysis.mjs ./tool/trace-explainer-analysis.mjs
COPY apps/client/tool/prompts/trace-narration/SYSTEM.md ./tool/prompts/trace-narration/SYSTEM.md

USER 65532:65532
EXPOSE 9460
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=12 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:9460/health').then(r=>{if(!r.ok)process.exit(1)})"]
ENTRYPOINT ["node", "server.mjs"]
