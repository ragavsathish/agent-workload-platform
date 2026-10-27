import importlib.util
import json
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[3] / "tools/ops/digital_twin.py"
SPEC = importlib.util.spec_from_file_location("digital_twin_ops", MODULE_PATH)
assert SPEC and SPEC.loader
digital_twin_ops = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(digital_twin_ops)


def test_migration_update_requires_an_explicit_timezone():
    update = digital_twin_ops.migration_update("Europe/Helsinki")
    assert b'pk:timeZone "Europe/Helsinki"' in update
    assert b"__TIME_ZONE__" not in update
    with pytest.raises(SystemExit, match="Unknown IANA timezone"):
        digital_twin_ops.migration_update("Not/A_Real_Zone")


def test_migration_default_is_a_read_only_preview(monkeypatch, capsys):
    calls = []

    def query_only(path, content_type, data, accept=None):
        calls.append((path, content_type, data.decode(), accept))
        return json.dumps({"results": {"bindings": [{"count": {"value": "2"}}]}}).encode()

    monkeypatch.setattr(digital_twin_ops, "oxigraph", query_only)
    digital_twin_ops.migrate(apply=False, time_zone=None)

    report = json.loads(capsys.readouterr().out)
    assert report["mode"] == "preview"
    assert report["dailyJournalPages"] == 2
    assert report["classifierPredictions"] == 2
    assert len(calls) == 2
    assert all(call[0] == "query" for call in calls)
    assert all(call[1] == "application/sparql-query" for call in calls)
