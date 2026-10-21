Run exactly one bash tool command in the Gondolin VM, then report its exit status.

Command: cd /workspace/products/voice-agent/apps/client && driver=$(docker info --format '{{.Driver}}') && echo storage-driver=$driver && test "$driver" = overlay2 && ip -br link && ip route && getent ahostsv4 registry.npmjs.org && npm ci --no-audit --no-fund --loglevel verbose; npm_status=$?; if [ "$npm_status" -ne 0 ]; then echo '--- npm debug log tail ---'; tail -n 120 "$(find /root/.npm/_logs -name '*debug-0.log' -type f -print | sort | tail -1)"; exit "$npm_status"; fi; npx playwright install chromium && git config --global --add safe.directory /workspace/products/voice-agent/apps/client/.flutter_tooling/flutter-3.47.7 && npm run test:patrol

Do not modify source files or retry failures.
