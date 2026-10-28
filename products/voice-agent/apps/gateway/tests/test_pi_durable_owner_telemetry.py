import errno
from email.message import Message
from urllib.error import HTTPError, URLError

import pytest
from voice_agent.tasking.infrastructure import pi_durable_owner


@pytest.mark.parametrize(
    ("failure", "kind"),
    [
        (URLError(OSError(errno.ENETUNREACH, "private network detail")), "network_unreachable"),
        (URLError(TimeoutError("private timeout detail")), "timeout"),
        (TimeoutError("private read timeout detail"), "timeout"),
        (URLError(ConnectionRefusedError(errno.ECONNREFUSED, "private detail")), "connection_refused"),
        (HTTPError("http://private.invalid", 503, "private detail", Message(), None), "http_5xx"),
    ],
)
def test_owner_failure_records_bounded_transport_cause(monkeypatch, tmp_path, failure, kind):
    token_file = tmp_path / "token"
    token_file.write_text("private-token", encoding="utf-8")
    owner = pi_durable_owner.PiDurableOwner("http://private.invalid", token_file)
    recorded = []
    span_attributes = []

    class Counter:
        def add(self, count, attributes):
            recorded.append((count, attributes))

    class Span:
        def set_attributes(self, attributes):
            span_attributes.append(attributes)

    def fail_request(*_args, **_kwargs):
        raise failure

    monkeypatch.setattr(pi_durable_owner, "urlopen", fail_request)
    monkeypatch.setattr(pi_durable_owner, "_transport_errors", Counter())
    monkeypatch.setattr(pi_durable_owner.trace, "get_current_span", lambda: Span())

    with pytest.raises(RuntimeError, match="Pi Durable owner is unavailable"):
        owner.list_native("private-identity")

    expected = {"owner.command": "list_native", "owner.failure_kind": kind}
    assert recorded == [(1, expected)]
    assert span_attributes == [expected]
