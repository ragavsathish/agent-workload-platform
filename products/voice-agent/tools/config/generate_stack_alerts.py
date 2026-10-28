"""Generate Grafana-managed alert rules for the deployed voice stack."""

from __future__ import annotations

import json
from pathlib import Path

RULES = (
    (
        "awp_core_telemetry_missing",
        "Core service telemetry missing",
        '6 - count(count by (service_name) (pipecat_operation_total{app_operation="component.started",service_name=~"pipecat-voice-edge|pipecat-mlx-inference|pipecat-pi-voice|pipecat-agent-gateway|pipecat-image-builder|pi-durable-owner"})) or vector(6)',
        0,
        "3m",
        "A core service stopped exporting metrics. Check process health and OTEL connectivity.",
    ),
    (
        "awp_infrastructure_scrape_down",
        "Infrastructure metric scrape down",
        'sum(up{job=~"macos-host-system|docker-desktop-system|gondolin-vms|grafana-mcp"} == bool 0) or vector(0)',
        0,
        "2m",
        "Prometheus cannot scrape a host, Docker, Gondolin, or Grafana MCP exporter.",
    ),
    (
        "awp_voice_operation_errors",
        "Voice path errors",
        'sum(increase(pipecat_operation_total{app_outcome="error",service_name=~"pipecat-voice-edge|pipecat-mlx-inference|pipecat-pi-voice",app_operation!="task.gateway"}[5m])) or vector(0)',
        2,
        "1m",
        "Voice, inference, or Pi turn errors exceeded the five-minute threshold.",
    ),
    (
        "awp_browser_task_errors",
        "Browser task path errors",
        'sum(increase(pipecat_operation_total{service_name="pipecat-voice-edge",app_operation="task.gateway",app_outcome="error"}[5m])) or vector(0)',
        2,
        "1m",
        "The browser-facing task path failed more than once in five minutes.",
    ),
    (
        "awp_owner_transport_errors",
        "Pi Durable owner transport failure",
        'sum(increase(pi_durable_owner_transport_errors_total[5m])) or vector(0)',
        0,
        "1m",
        "The gateway could not reach the Pi Durable owner. Inspect the failure kind.",
    ),
    (
        "awp_collector_rejections",
        "OTEL collector rejected telemetry",
        '(sum(increase(otelcol_receiver_failed_metric_points_total[5m])) or vector(0)) + (sum(increase(otelcol_receiver_refused_metric_points_total[5m])) or vector(0)) + (sum(increase(otelcol_receiver_failed_spans_total[5m])) or vector(0)) + (sum(increase(otelcol_receiver_refused_spans_total[5m])) or vector(0))',
        0,
        "1m",
        "The OTEL collector failed or refused metric points or spans.",
    ),
    (
        "awp_host_disk_low",
        "Mac data volume below 20 GiB",
        '21474836480 - min(node_filesystem_avail_bytes{job="macos-host-system",mountpoint="/System/Volumes/Data"})',
        0,
        "5m",
        "The Mac data volume has less than 20 GiB free.",
    ),
    (
        "awp_docker_memory_low",
        "Docker VM below 1 GiB available memory",
        '1073741824 - min(node_memory_MemAvailable_bytes{job="docker-desktop-system"})',
        0,
        "5m",
        "The Docker Desktop VM has less than 1 GiB available memory.",
    ),
)


def rule(uid: str, title: str, promql: str, threshold: int, pending: str, summary: str) -> dict:
    expression_source = {
        "datasource": {"type": "__expr__", "uid": "__expr__"},
        "intervalMs": 1000,
        "maxDataPoints": 43200,
    }
    return {
        "uid": uid,
        "title": title,
        "condition": "C",
        "data": [
            {
                "refId": "A",
                "relativeTimeRange": {"from": 300, "to": 0},
                "datasourceUid": "prometheus",
                "model": {
                    "expr": promql,
                    "instant": True,
                    "intervalMs": 1000,
                    "maxDataPoints": 43200,
                    "refId": "A",
                },
            },
            {
                "refId": "B",
                "relativeTimeRange": {"from": 0, "to": 0},
                "datasourceUid": "__expr__",
                "model": {**expression_source, "expression": "A", "type": "reduce", "reducer": "last", "refId": "B"},
            },
            {
                "refId": "C",
                "relativeTimeRange": {"from": 0, "to": 0},
                "datasourceUid": "__expr__",
                "model": {
                    **expression_source,
                    "expression": "B",
                    "type": "threshold",
                    "conditions": [
                        {
                            "evaluator": {"params": [threshold], "type": "gt"},
                            "operator": {"type": "and"},
                            "query": {"params": ["C"]},
                            "reducer": {"type": "last"},
                            "type": "query",
                        }
                    ],
                    "refId": "C",
                },
            },
        ],
        "noDataState": "Alerting",
        "execErrState": "Alerting",
        "for": pending,
        "annotations": {"summary": summary},
        "labels": {"managed_by": "agent-workload-platform", "auto_investigate": "true"},
    }


def main() -> None:
    target = Path(__file__).resolve().parents[2] / "deploy/observability/stack-alerts.json"
    payload = {
        "apiVersion": 1,
        "groups": [
            {
                "orgId": 1,
                "name": "Stack health",
                "folder": "Pipecat Voice",
                "interval": "1m",
                "rules": [rule(*definition) for definition in RULES],
            }
        ],
    }
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
