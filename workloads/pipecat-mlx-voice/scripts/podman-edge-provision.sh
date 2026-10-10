#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
machine_name="${PODMAN_EDGE_MACHINE:-pipecat-edge}"
edge_env="$repo_dir/edge/.env"
host_env="$repo_dir/server/.env"
tailscale_image="docker.io/tailscale/tailscale@sha256:c507f3a2a6ab1cabd8d809b98edeb41edbd5c3fb6ad9632ffd098b4c7d0b4065"
build_dir="$(mktemp -d)"
render_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir" "$render_dir"' EXIT

"$repo_dir/scripts/podman-edge-create.sh" >/dev/null

if [[ ! -f "$edge_env" ]]; then
  install -m 600 "$repo_dir/edge/.env.example" "$edge_env"
  echo "Created edge/.env; Tailscale login will replace its identity placeholders." >&2
fi

broker_token="$(sed -n 's/^INFERENCE_BROKER_TOKEN=//p' "$host_env" | tail -1)"
if [[ ${#broker_token} -lt 32 ]]; then
  echo "server/.env needs an INFERENCE_BROKER_TOKEN of at least 32 characters" >&2
  exit 1
fi

cd "$repo_dir/client"
npm ci
npm run build

cd "$repo_dir/edge"
uv lock --check
install -m 644 Containerfile pyproject.toml uv.lock bot.py "$build_dir/"
cp -R "$repo_dir/client/dist" "$build_dir/client-dist"

# Registry inputs are content-addressed. Pulling verifies those exact manifests;
# the build itself is forbidden from consulting mutable tags.
podman pull "ghcr.io/astral-sh/uv@sha256:88bc6eb1ccd4b82efd0e1b530caffabddf50dc2bf612e66c14ea25b8ee8a4d3d" >/dev/null
podman pull "docker.io/library/python@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f" >/dev/null
podman pull "$tailscale_image" >/dev/null
podman build --format=docker --pull=never --tag localhost/pipecat-edge:staging "$build_dir"

edge_digest="$(podman image inspect localhost/pipecat-edge:staging --format '{{.Digest}}')"
if [[ ! "$edge_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Built edge image did not produce a content digest" >&2
  exit 1
fi
edge_ref="localhost/pipecat-edge@$edge_digest"
edge_tag="localhost/pipecat-edge:sha-${edge_digest#sha256:}"
edge_tag="${edge_tag:0:46}"
podman tag localhost/pipecat-edge:staging "$edge_tag"

podman run --rm "$edge_ref" --help >/dev/null
printf '%s' "$broker_token" | podman secret create --replace pipecat-broker-token - >/dev/null

for source in "$repo_dir"/deploy/quadlet/*; do
  target="$render_dir/$(basename "$source")"
  sed \
    -e "s|__PIPECAT_EDGE_IMAGE__|$edge_ref|g" \
    -e "s|__TAILSCALE_IMAGE__|$tailscale_image|g" \
    "$source" > "$target"
done

identity="$(podman machine inspect --format '{{.SSHConfig.IdentityPath}}' "$machine_name")"
port="$(podman machine inspect --format '{{.SSHConfig.Port}}' "$machine_name")"
user="$(podman machine inspect --format '{{.SSHConfig.RemoteUsername}}' "$machine_name")"
ssh_args=(-o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -i "$identity" -P "$port")

"$repo_dir/scripts/podman-edge-ssh.sh" \
  "rm -rf ~/.config/pipecat-edge/incoming && mkdir -p ~/.config/pipecat-edge/incoming ~/.config/containers/systemd && chmod 700 ~/.config/pipecat-edge"
scp "${ssh_args[@]}" "$edge_env" "$user@127.0.0.1:.config/pipecat-edge/incoming/edge.env"
scp "${ssh_args[@]}" "$render_dir"/* "$user@127.0.0.1:.config/pipecat-edge/incoming/"

deploy_command='set -e
config="$HOME/.config/containers/systemd"
incoming="$HOME/.config/pipecat-edge/incoming"
rollback="$HOME/.config/pipecat-edge/rollback"
rm -rf "$rollback"
mkdir -p "$rollback"
cp -p "$config"/* "$rollback"/ 2>/dev/null || true
install -m 600 "$incoming/edge.env" "$HOME/.config/pipecat-edge/edge.env"
install -m 600 "$incoming"/*.container "$incoming"/*.pod "$incoming"/*.volume "$config"/
systemctl --user daemon-reload
systemctl --user reset-failed
systemctl --user restart pipecat-edge.service
systemctl --user restart pipecat-tailscale.service'

if ! "$repo_dir/scripts/podman-edge-ssh.sh" "$deploy_command"; then
  echo "Deployment failed; restoring the previous Quadlet configuration" >&2
  "$repo_dir/scripts/podman-edge-ssh.sh" \
    'cp -p ~/.config/pipecat-edge/rollback/* ~/.config/containers/systemd/ 2>/dev/null || true; systemctl --user daemon-reload; systemctl --user restart pipecat-edge.service pipecat-tailscale.service'
  exit 1
fi

"$repo_dir/scripts/podman-edge-verify.sh"

# Reclaim only superseded images carrying this project's label.
deployed_id="$(podman image inspect "$edge_ref" --format '{{.Id}}')"
podman image rm localhost/pipecat-edge:current localhost/pipecat-edge:staging >/dev/null 2>&1 || true
while IFS= read -r image_id; do
  [[ -z "$image_id" || "$image_id" == "$deployed_id" ]] && continue
  podman image rm "$image_id" >/dev/null 2>&1 || true
done < <(podman images --filter label=io.pipecat.edge=true --format '{{.Id}}' | sort -u)

echo "Deployed immutable edge image: $edge_ref"
