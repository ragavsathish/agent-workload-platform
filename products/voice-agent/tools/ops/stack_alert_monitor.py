"""Turn firing Grafana stack alerts into idempotent Pi Durable investigations."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import os
import re
import socket
import sqlite3
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

GRAFANA_ALERTS_URL = "http://127.0.0.1:3300/api/prometheus/grafana/api/v1/alerts"
PROMETHEUS_URL = "http://127.0.0.1:9091"
COOLDOWN_SECONDS = 1800
SAFE_LABEL = re.compile(r"^[A-Za-z0-9_.:/-]{1,100}$")
DIAGNOSTIC_QUERIES = {
    "awp_core_telemetry_missing": {
        "core_telemetry_age_seconds": 'time() - timestamp(pipecat_operation_total{app_operation="component.started",service_name=~"pipecat-voice-edge|pipecat-mlx-inference|pipecat-pi-voice|pipecat-agent-gateway|pipecat-image-builder|pi-durable-owner"})',
    },
    "awp_infrastructure_scrape_down": {
        "scrape_up": 'up{job=~"macos-host-system|docker-desktop-system|gondolin-vms|grafana-mcp"}',
    },
    "awp_voice_operation_errors": {
        "voice_errors_by_operation": 'sum by (service_name,app_operation) (increase(pipecat_operation_total{app_outcome="error",service_name=~"pipecat-voice-edge|pipecat-mlx-inference|pipecat-pi-voice",app_operation!="task.gateway"}[5m]))',
    },
    "awp_owner_transport_errors": {
        "owner_errors_by_kind": 'sum by (owner_command,owner_failure_kind) (increase(pi_durable_owner_transport_errors_total[5m]))',
    },
}
GRAFANA_OUTAGE_RULE = {
    "title": "Grafana alert API unavailable",
    "promql": "up",
    "summary": "The host monitor could not read Grafana alerts for three consecutive polls. Check Grafana health at http://127.0.0.1:3300/api/health and the otel-lgtm container.",
}


def allowed_rules(path: Path) -> dict[str, dict[str, str]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    return {
        rule["uid"]: {
            "title": rule["title"],
            "promql": rule["data"][0]["model"]["expr"],
            "summary": rule["annotations"]["summary"],
        }
        for group in document["groups"]
        for rule in group["rules"]
        if rule.get("labels", {}).get("auto_investigate") == "true"
    }


def fetch_alerts(password_file: Path) -> list[dict]:
    password = password_file.read_text(encoding="utf-8").strip()
    authorization = base64.b64encode(f"admin:{password}".encode()).decode()
    request = Request(GRAFANA_ALERTS_URL, headers={"Authorization": f"Basic {authorization}"})
    with urlopen(request, timeout=10) as response:
        document = json.load(response)
    if document.get("status") != "success" or not isinstance(document.get("data", {}).get("alerts"), list):
        raise ValueError("Grafana returned an invalid alert list")
    return document["data"]["alerts"]


def owner_submit(socket_path: Path, request_id: str, identity: str, instruction: str) -> None:
    message = {
        "id": str(uuid.uuid4()),
        "command": "submit",
        "requestId": request_id,
        "input": {
            "kind": "agent-run",
            "requestId": request_id,
            "params": {
                "identity": identity,
                "workspace": "scratch",
                "instruction": instruction,
                "native_cli": True,
            },
        },
    }
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(30)
        connection.connect(str(socket_path))
        connection.sendall(json.dumps(message, separators=(",", ":")).encode() + b"\n")
        response = b""
        while b"\n" not in response:
            chunk = connection.recv(65536)
            if not chunk:
                raise ConnectionError("Pi Durable owner closed the socket")
            response += chunk
            if len(response) > 262144:
                raise ValueError("Pi Durable owner response exceeded limit")
    result = json.loads(response.split(b"\n", 1)[0])
    if not result.get("success"):
        raise RuntimeError("Pi Durable owner rejected the investigation")


def incident_key(alert: dict, rules: dict[str, dict[str, str]]) -> str | None:
    labels = alert.get("labels")
    if not isinstance(labels, dict):
        return None
    if labels.get("auto_investigate") != "true" or labels.get("managed_by") != "agent-workload-platform":
        return None
    uid = labels.get("rule_uid")
    if uid not in rules:
        matches = [key for key, rule in rules.items() if rule["title"] == labels.get("alertname")]
        if len(matches) != 1:
            return None
        uid = matches[0]
    if str(alert.get("state", "")).lower() not in {"firing", "alerting"}:
        return None
    fingerprint = alert.get("fingerprint")
    if not isinstance(fingerprint, str) or not fingerprint:
        fingerprint = hashlib.sha256(json.dumps(labels, sort_keys=True).encode()).hexdigest()
    return f"{uid}:{fingerprint}"


def collect_evidence(uid: str, rule: dict[str, str]) -> str:
    """Capture bounded, payload-free Prometheus facts on the host."""
    snapshot: dict[str, object] = {"captured_at_unix": int(time.time()), "queries": {}}
    queries = {"alert_value": rule["promql"], **DIAGNOSTIC_QUERIES.get(uid, {})}
    for name, expression in queries.items():
        request = Request(f"{PROMETHEUS_URL}/api/v1/query?{urlencode({'query': expression})}")
        try:
            with urlopen(request, timeout=3) as response:
                document = json.load(response)
            if document.get("status") != "success":
                raise ValueError("Prometheus query failed")
            samples = []
            for item in document.get("data", {}).get("result", [])[:12]:
                raw = item.get("value", [None, None])[1]
                value = float(raw)
                if not math.isfinite(value):
                    continue
                labels = {
                    key: label
                    for key, label in item.get("metric", {}).items()
                    if key in {"service_name", "app_operation", "job", "instance", "owner_command", "owner_failure_kind"}
                    and isinstance(label, str) and SAFE_LABEL.fullmatch(label)
                }
                samples.append({"labels": labels, "value": round(value, 3)})
            snapshot["queries"][name] = samples
        except Exception as exc:
            snapshot["queries"][name] = {"unavailable": type(exc).__name__}
    rendered = json.dumps(snapshot, separators=(",", ":"))
    if len(rendered) <= 4000:
        return rendered
    snapshot["queries"] = {
        name: value[:2] if isinstance(value, list) else value
        for name, value in snapshot["queries"].items()
    }
    snapshot["truncated"] = True
    return json.dumps(snapshot, separators=(",", ":"))


def instruction_for(uid: str, rule: dict[str, str]) -> str:
    evidence = collect_evidence(uid, rule)
    return (
        f"Investigate the firing stack health alert {rule['title']} ({uid}). "
        f"Meaning: {rule['summary']} Host monitor PromQL: {rule['promql']} "
        f"Host-collected, payload-free evidence: {evidence} "
        "This task sandbox cannot access the host's 127.0.0.1 Prometheus endpoint. "
        "Use the supplied evidence to report observed facts, probable cause, impact, "
        "uncertainties, and a recommended next action. Do not claim checks you could not run. "
        "Do not change files, restart services, or perform remediation."
    )


def open_database(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    database = sqlite3.connect(path)
    database.execute(
        "CREATE TABLE IF NOT EXISTS incidents ("
        "key TEXT PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, "
        "last_submitted INTEGER, active INTEGER NOT NULL, submitted INTEGER NOT NULL, "
        "instruction TEXT NOT NULL)"
    )
    database.commit()
    return database


def process_alerts(
    database: sqlite3.Connection,
    alerts: list[dict],
    rules: dict[str, dict[str, str]],
    identity: str,
    socket_path: Path,
    now: int,
    clear_missing: bool = True,
) -> list[str]:
    active_keys: set[str] = set()
    submitted: list[str] = []
    for alert in alerts:
        key = incident_key(alert, rules)
        if key is None or key in active_keys:
            continue
        active_keys.add(key)
        uid = key.split(":", 1)[0]
        row = database.execute(
            "SELECT first_seen, last_submitted, active, submitted, instruction "
            "FROM incidents WHERE key=?", (key,)
        ).fetchone()
        if row is None:
            first_seen, last_submitted, was_active, was_submitted = now, None, 0, 0
            instruction = instruction_for(uid, rules[uid])
        else:
            first_seen, last_submitted, was_active, was_submitted, instruction = row
        if not was_active and was_submitted and last_submitted is not None:
            if now - last_submitted >= COOLDOWN_SECONDS:
                first_seen, was_submitted = now, 0
                instruction = instruction_for(uid, rules[uid])
        database.execute(
            "INSERT OR REPLACE INTO incidents VALUES (?, ?, ?, ?, 1, ?, ?)",
            (key, first_seen, now, last_submitted, was_submitted, instruction),
        )
        database.commit()
        if was_submitted:
            continue
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"awp-stack-alert:{key}:{first_seen}"))
        owner_submit(socket_path, request_id, identity, instruction)
        database.execute(
            "UPDATE incidents SET submitted=1, last_submitted=? WHERE key=?", (now, key)
        )
        database.commit()
        submitted.append(uid)
    if clear_missing:
        for (key,) in database.execute("SELECT key FROM incidents WHERE active=1"):
            if key not in active_keys:
                database.execute("UPDATE incidents SET active=0 WHERE key=?", (key,))
    database.commit()
    return submitted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    identity_values = [x.strip().lower() for x in os.environ.get("ORCHESTRATOR_ALLOWED_USERS", "").split(",") if x.strip()]
    if len(identity_values) != 1:
        raise ValueError("alert monitor requires exactly one owner identity")
    runtime = Path(os.environ.get("PI_DURABLE_ALERT_RUNTIME", Path.home() / "Library/Application Support/PipecatEdge"))
    rules = allowed_rules(runtime / "observability/stack-alerts.json")
    rules["awp_grafana_api_unavailable"] = GRAFANA_OUTAGE_RULE
    socket_path = Path(os.environ.get("PI_DURABLE_OWNER_SOCKET", f"/tmp/awp-pi-owner-{os.getuid()}/owner.sock"))
    database = open_database(runtime / "alert-monitor/incidents.sqlite")
    password_file = runtime / "secrets/grafana-admin-password"
    grafana_failures = 0
    while True:
        try:
            alerts = fetch_alerts(password_file)
        except Exception as exc:
            grafana_failures += 1
            print(f"Grafana alert poll failed: {type(exc).__name__}", file=sys.stderr, flush=True)
            if grafana_failures >= 3:
                alerts = [{
                    "state": "Alerting",
                    "labels": {
                        "alertname": GRAFANA_OUTAGE_RULE["title"],
                        "auto_investigate": "true",
                        "managed_by": "agent-workload-platform",
                    },
                }]
                try:
                    process_alerts(database, alerts, rules, identity_values[0], socket_path, int(time.time()), clear_missing=False)
                except Exception as submit_exc:
                    print(f"Grafana outage investigation failed: {type(submit_exc).__name__}", file=sys.stderr, flush=True)
            if args.once:
                return 1
        else:
            grafana_failures = 0
            try:
                submitted = process_alerts(database, alerts, rules, identity_values[0], socket_path, int(time.time()))
                for uid in submitted:
                    print(f"submitted Pi Durable investigation for {uid}", flush=True)
            except Exception as exc:
                print(f"alert investigation failed: {type(exc).__name__}", file=sys.stderr, flush=True)
                if args.once:
                    return 1
        if args.once:
            return 0
        time.sleep(60)


if __name__ == "__main__":
    raise SystemExit(main())
