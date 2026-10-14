#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$root" rev-parse --show-toplevel)"
repository_name="$(basename "$repository_root")"
owner="source-publisher"
endpoint="http://127.0.0.1:3001"
password_file="$root/deploy/secrets/gitea-admin-password"
agent_password_file="$root/deploy/secrets/gitea-agent-password"
agent_token_file="$root/deploy/secrets/gitea-agent-token"
agent_token_scopes_file="$root/deploy/secrets/gitea-agent-token.scopes"
agent_token_scopes="public-only,read:repository,read:issue,read:user,read:organization"
compose=(docker compose --env-file "$root/deploy/.env" -f "$root/deploy/compose.yml")

[[ -s "$password_file" ]] || { echo "Missing generated Gitea bootstrap secret" >&2; exit 1; }
[[ -s "$agent_password_file" ]] || { echo "Missing generated Gitea agent secret" >&2; exit 1; }
password="$(<"$password_file")"
agent_password="$(<"$agent_password_file")"

if ! "${compose[@]}" exec -T -e GITEA_BOOTSTRAP_PASSWORD="$password" gitea sh -eu -c '
  gitea admin user create \
    --username source-publisher \
    --password "$GITEA_BOOTSTRAP_PASSWORD" \
    --email source-publisher@localhost.invalid \
    --admin \
    --must-change-password=false >/dev/null 2>&1 ||
  gitea admin user change-password \
    --username source-publisher \
    --password "$GITEA_BOOTSTRAP_PASSWORD" >/dev/null
  gitea admin user must-change-password --all --unset >/dev/null
'; then
  echo "Could not bootstrap the private Gitea publisher" >&2
  exit 1
fi

if ! "${compose[@]}" exec -T -e GITEA_AGENT_PASSWORD="$agent_password" gitea sh -eu -c '
  gitea admin user create \
    --username voice-agent \
    --password "$GITEA_AGENT_PASSWORD" \
    --email voice-agent@localhost.invalid \
    --restricted \
    --must-change-password=false >/dev/null 2>&1 ||
  gitea admin user change-password \
    --username voice-agent \
    --password "$GITEA_AGENT_PASSWORD" >/dev/null
  gitea admin user must-change-password --all --unset >/dev/null
'; then
  echo "Could not bootstrap the restricted Gitea agent identity" >&2
  exit 1
fi

agent_token=""
if [[ -s "$agent_token_file" && -s "$agent_token_scopes_file" \
  && "$(<"$agent_token_scopes_file")" == "$agent_token_scopes" ]]; then
  candidate_token="$(<"$agent_token_file")"
  if [[ "$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: token $candidate_token" "$endpoint/api/v1/user" || true)" == 200 ]]; then
    agent_token="$candidate_token"
  fi
fi
if [[ -z "$agent_token" ]]; then
  agent_token="$("${compose[@]}" exec -T gitea gitea admin user generate-access-token \
    --username voice-agent \
    --token-name "voice-agent-$(date +%s)" \
    --scopes "$agent_token_scopes" \
    --raw | tr -d '\r\n')"
  [[ -n "$agent_token" ]] || { echo "Gitea did not issue an agent token" >&2; exit 1; }
  temporary_token_file="${agent_token_file}.part"
  printf '%s\n' "$agent_token" > "$temporary_token_file"
  chmod 600 "$temporary_token_file"
  mv "$temporary_token_file" "$agent_token_file"
  temporary_scopes_file="${agent_token_scopes_file}.part"
  printf '%s\n' "$agent_token_scopes" > "$temporary_scopes_file"
  chmod 600 "$temporary_scopes_file"
  mv "$temporary_scopes_file" "$agent_token_scopes_file"
fi

GITEA_ENDPOINT="$endpoint" \
GITEA_OWNER="$owner" \
GITEA_PASSWORD="$password" \
GITEA_REPOSITORY="$repository_name" \
python3 - <<'PY'
import base64
import json
import os
import urllib.error
import urllib.request

endpoint = os.environ["GITEA_ENDPOINT"]
owner = os.environ["GITEA_OWNER"]
password = os.environ["GITEA_PASSWORD"]
repository = os.environ["GITEA_REPOSITORY"]
authorization = base64.b64encode(f"{owner}:{password}".encode()).decode()
request = urllib.request.Request(
    f"{endpoint}/api/v1/user/repos",
    data=json.dumps({"name": repository, "private": False}).encode(),
    headers={"Authorization": f"Basic {authorization}", "Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(request, timeout=10).close()
except urllib.error.HTTPError as error:
    if error.code != 409:
        raise
PY

mirror="$(mktemp -d "${TMPDIR:-/tmp}/voice-gitea-mirror.XXXXXX")"
trap 'rm -rf "$mirror"' EXIT
git clone --quiet --bare "$repository_root" "$mirror/repository.git"
authorization="$(printf '%s:%s' "$owner" "$password" | base64 | tr -d '\n')"
GIT_CONFIG_COUNT=1 \
GIT_CONFIG_KEY_0=http.extraHeader \
GIT_CONFIG_VALUE_0="Authorization: Basic $authorization" \
git -C "$mirror/repository.git" push --quiet --mirror \
  "$endpoint/$owner/$repository_name.git"

printf 'Published committed Git state to %s/%s/%s.git\n' "$endpoint" "$owner" "$repository_name"
