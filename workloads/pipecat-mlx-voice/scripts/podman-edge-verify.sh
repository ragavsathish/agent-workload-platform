#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"

fail() {
  echo "VERIFY FAILED: $*" >&2
  exit 1
}

[[ "$(podman machine inspect --format '{{.State}}' "$machine_name")" == "running" ]] || fail "VM is not running"
[[ "$(podman machine inspect --format '{{.Rootful}}' "$machine_name")" == "false" ]] || fail "Podman machine is rootful"

if "$repo_dir/scripts/podman-edge-ssh.sh" "mount | grep -Eq 'type (virtiofs|9p)| on /(Users|private)(/| )'"; then
  fail "a macOS filesystem mount is visible inside the VM"
fi

for container in pipecat-edge-app pipecat-tailscale; do
  [[ "$(podman inspect "$container" --format '{{.State.Running}}')" == "true" ]] || fail "$container is not running"
  [[ "$(podman inspect "$container" --format '{{.HostConfig.ReadonlyRootfs}}')" == "true" ]] || fail "$container root is writable"
  [[ "$(podman inspect "$container" --format '{{.HostConfig.Privileged}}')" == "false" ]] || fail "$container is privileged"
  [[ "$(podman inspect "$container" --format '{{.Config.Labels.PODMAN_SYSTEMD_UNIT}}')" != "<no value>" ]] || fail "$container is not systemd managed"
  image_name="$(podman inspect "$container" --format '{{.ImageName}}')"
  [[ "$image_name" == *@sha256:* ]] || fail "$container is not using a digest-pinned image: $image_name"
  security="$(podman inspect "$container" --format '{{json .HostConfig.SecurityOpt}}')"
  [[ "$security" == *no-new-privileges* ]] || fail "$container lacks no-new-privileges"
  caps="$(podman exec "$container" awk '/^(CapEff|CapBnd):/ {print $2}' /proc/1/status | sort -u)"
  [[ "$caps" == "0000000000000000" ]] || fail "$container has effective or bounding capabilities: $caps"
  nnp="$(podman exec "$container" awk '/^NoNewPrivs:/ {print $2}' /proc/1/status)"
  [[ "$nnp" == "1" ]] || fail "$container can gain privileges"
done

[[ "$(podman inspect pipecat-edge-app --format '{{len .Mounts}}')" == "0" ]] || fail "edge app has an unexpected ordinary mount"
edge_secrets="$(podman inspect pipecat-edge-app --format '{{range .Config.Secrets}}{{.Name}} {{end}}')"
[[ "$edge_secrets" == "pipecat-broker-token " ]] || fail "edge app has unexpected secrets: $edge_secrets"
[[ "$(podman inspect pipecat-tailscale --format '{{len .Mounts}}')" == "1" ]] || fail "Tailscale has an unexpected mount count"
ts_mount="$(podman inspect pipecat-tailscale --format '{{range .Mounts}}{{.Type}}:{{.Destination}}{{end}}')"
[[ "$ts_mount" == "volume:/var/lib/tailscale" ]] || fail "Tailscale has an unexpected mount: $ts_mount"

podman exec pipecat-edge-app sh -c 'test ! -S /run/podman/podman.sock && test ! -S /var/run/docker.sock' || fail "container engine socket is exposed"

broker_code=""
for _ in {1..30}; do
  broker_code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/health || true)"
  [[ "$broker_code" == "401" ]] && break
  sleep 1
done
[[ "$broker_code" == "401" ]] || fail "loopback broker did not return 401 without its capability ($broker_code)"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:9443/docs)" == "404" ]] || fail "broker API documentation is exposed"

podman exec pipecat-edge-app python - <<'PY' || fail "edge cannot authenticate to the broker"
import json
import urllib.request

token = open("/run/secrets/broker-token", encoding="utf-8").read()
request = urllib.request.Request(
    "http://127.0.0.1:9443/health",
    headers={"Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(request, timeout=5) as response:
    assert json.load(response) == {"status": "ok"}
PY

for label in com.sathish.pipecat-edge-machine com.sathish.pipecat-broker com.sathish.pipecat-edge-tunnel; do
  launchctl print "gui/$UID/$label" >/dev/null 2>&1 || fail "LaunchAgent $label is not loaded"
done

backend_state="$(podman exec pipecat-tailscale tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("BackendState", "Unknown"))' || true)"
if [[ "$backend_state" != "Running" ]]; then
  if [[ "${REQUIRE_TAILSCALE:-0}" == "1" ]]; then
    fail "Tailscale is not authenticated ($backend_state)"
  fi
  echo "VERIFY WARNING: Tailscale is not authenticated ($backend_state); run make edge-status and authorize its URL" >&2
fi

echo "Immutable edge verification passed (Tailscale: ${backend_state:-Unknown})."
