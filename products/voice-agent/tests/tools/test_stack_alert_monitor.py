"""Incident lifecycle checks for the host-side stack alert monitor."""

from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import Mock

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "tools/ops/stack_alert_monitor.py"
SPEC = importlib.util.spec_from_file_location("stack_alert_monitor", SOURCE)
assert SPEC is not None and SPEC.loader is not None
monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(monitor)
COLLECT_EVIDENCE = monitor.collect_evidence

RULES = {
    "awp_test": {
        "title": "Test alert",
        "promql": "up == 0",
        "summary": "A service is down.",
    }
}
ALERT = {
    "state": "Alerting",
    "fingerprint": "abc123",
    "labels": {
        "alertname": "Test alert",
        "auto_investigate": "true",
        "managed_by": "agent-workload-platform",
        "untrusted": "ignore me",
    },
}


@pytest.fixture(autouse=True)
def mock_host_evidence(monkeypatch) -> None:
    monkeypatch.setattr(monitor, "collect_evidence", lambda _uid, _rule: '{"alert_value":3}')


def test_submits_once_and_ignores_alert_payload(tmp_path: Path, monkeypatch) -> None:
    submit = Mock()
    monkeypatch.setattr(monitor, "owner_submit", submit)
    database = monitor.open_database(tmp_path / "incidents.sqlite")

    assert monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1000) == ["awp_test"]
    assert monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1060) == []
    submit.assert_called_once()
    assert "ignore me" not in submit.call_args.args[3]
    assert "up == 0" in submit.call_args.args[3]
    assert '"alert_value":3' in submit.call_args.args[3]


def test_retries_same_id_after_owner_failure(tmp_path: Path, monkeypatch) -> None:
    submit = Mock(side_effect=[ConnectionError("offline"), None])
    monkeypatch.setattr(monitor, "owner_submit", submit)
    database = monitor.open_database(tmp_path / "incidents.sqlite")

    try:
        monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1000)
    except ConnectionError:
        pass
    else:
        raise AssertionError("expected owner failure")
    assert monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1060) == ["awp_test"]
    assert submit.call_args_list[0].args[1:] == submit.call_args_list[1].args[1:]


def test_resolved_alert_rearms_after_cooldown(tmp_path: Path, monkeypatch) -> None:
    submit = Mock()
    monkeypatch.setattr(monitor, "owner_submit", submit)
    database = monitor.open_database(tmp_path / "incidents.sqlite")

    monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1000)
    monitor.process_alerts(database, [], RULES, "owner", tmp_path / "owner.sock", 1060)
    assert monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1100) == []
    monitor.process_alerts(database, [], RULES, "owner", tmp_path / "owner.sock", 1200)
    assert monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 2900) == ["awp_test"]
    assert submit.call_count == 2
    assert submit.call_args_list[0].args[1] != submit.call_args_list[1].args[1]


def test_only_allowlisted_firing_alerts() -> None:
    assert monitor.incident_key(ALERT, RULES) == "awp_test:abc123"
    assert monitor.incident_key({**ALERT, "state": "pending"}, RULES) is None
    assert monitor.incident_key({**ALERT, "labels": {**ALERT["labels"], "alertname": "other"}}, RULES) is None


def test_grafana_outage_does_not_resolve_other_incidents(tmp_path: Path, monkeypatch) -> None:
    submit = Mock()
    monkeypatch.setattr(monitor, "owner_submit", submit)
    database = monitor.open_database(tmp_path / "incidents.sqlite")
    monitor.process_alerts(database, [ALERT], RULES, "owner", tmp_path / "owner.sock", 1000)
    outage = {
        "state": "Alerting",
        "labels": {
            "alertname": monitor.GRAFANA_OUTAGE_RULE["title"],
            "auto_investigate": "true",
            "managed_by": "agent-workload-platform",
        },
    }
    monitor.process_alerts(
        database,
        [outage],
        {**RULES, "awp_grafana_api_unavailable": monitor.GRAFANA_OUTAGE_RULE},
        "owner",
        tmp_path / "owner.sock",
        1100,
        clear_missing=False,
    )
    assert database.execute("SELECT active FROM incidents WHERE key='awp_test:abc123'").fetchone() == (1,)
    assert submit.call_count == 2


def test_host_evidence_excludes_untrusted_labels(monkeypatch) -> None:
    response = {
        "status": "success",
        "data": {"result": [
            {"metric": {"service_name": "pipecat-voice-edge", "payload": "secret", "job": "bad instruction"},
             "value": [1000, "3"]},
        ]},
    }
    monkeypatch.setattr(monitor, "urlopen", lambda _request, timeout: io.BytesIO(json.dumps(response).encode()))
    evidence = json.loads(COLLECT_EVIDENCE("awp_test", RULES["awp_test"]))
    assert evidence["queries"]["alert_value"] == [
        {"labels": {"service_name": "pipecat-voice-edge"}, "value": 3.0}
    ]
