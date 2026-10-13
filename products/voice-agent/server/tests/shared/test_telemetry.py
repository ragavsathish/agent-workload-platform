from opentelemetry import metrics
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from voice_agent.shared.telemetry import Telemetry


def test_error_span_contains_no_exception_or_user_data() -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider(resource=Resource.create({"service.name": "test"}))
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    meter = metrics.get_meter("telemetry-test")
    telemetry = Telemetry(
        service_name="test",
        tracer=provider.get_tracer("telemetry-test"),
        meter=meter,
        operations=meter.create_counter("test.operation"),
        duration=meter.create_histogram("test.operation.duration"),
    )

    try:
        with telemetry.observe("fixed.operation"):
            raise RuntimeError("private transcript text")
    except RuntimeError:
        pass

    span = exporter.get_finished_spans()[0]
    assert span.status.status_code is StatusCode.ERROR
    assert dict(span.attributes or {}) == {"app.operation": "fixed.operation"}
    assert not span.events
