"""Payload-free OpenTelemetry metrics and traces shared by server processes.

Only fixed, low-cardinality operation and outcome attributes are emitted. Voice,
transcript, prompt, identity, workspace, proposal, and exception data must never
be passed to this module.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from time import monotonic

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.metrics import Counter, Histogram, Meter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Span, Status, StatusCode, Tracer


@dataclass(frozen=True)
class Telemetry:
    service_name: str
    tracer: Tracer
    meter: Meter
    operations: Counter
    duration: Histogram

    def record(
        self,
        operation: str,
        *,
        outcome: str = "ok",
        duration_seconds: float | None = None,
        count: int = 1,
    ) -> None:
        """Record a bounded event without accepting payload data."""
        attributes = {"app.operation": operation, "app.outcome": outcome}
        self.operations.add(count, attributes)
        if duration_seconds is not None:
            self.duration.record(max(0.0, duration_seconds), attributes)

    @contextmanager
    def observe(self, operation: str) -> Iterator[Span]:
        """Measure one named operation without recording its arguments or exception."""
        started = monotonic()
        outcome = "ok"
        attributes = {"app.operation": operation}
        with self.tracer.start_as_current_span(
            f"{self.service_name}.{operation}",
            attributes=attributes,
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            try:
                yield span
            except BaseException:
                outcome = "error"
                # Deliberately omit record_exception: messages can contain user data.
                span.set_status(Status(StatusCode.ERROR))
                raise
            finally:
                metric_attributes = {**attributes, "app.outcome": outcome}
                self.operations.add(1, metric_attributes)
                self.duration.record(monotonic() - started, metric_attributes)


def _signal_endpoint(base: str, signal: str) -> str:
    return f"{base.rstrip('/')}/v1/{signal}"


def configure_telemetry(service_name: str) -> Telemetry:
    """Configure OTLP traces and metrics when an endpoint is present.

    Logs are intentionally unsupported. With no endpoint, OpenTelemetry's no-op
    providers keep tests and standalone utilities independent of the collector.
    """
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    if endpoint and os.getenv("OTEL_SDK_DISABLED", "false").lower() != "true":
        resource = Resource.create(
            {
                "service.name": service_name,
                "service.namespace": "pipecat-mlx-voice",
                "deployment.environment.name": os.getenv(
                    "OTEL_DEPLOYMENT_ENVIRONMENT", "local"
                ),
            }
        )
        tracer_provider = TracerProvider(resource=resource)
        tracer_provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=_signal_endpoint(endpoint, "traces"))
            )
        )
        trace.set_tracer_provider(tracer_provider)

        interval = int(os.getenv("OTEL_METRIC_EXPORT_INTERVAL", "5000"))
        metric_reader = PeriodicExportingMetricReader(
            OTLPMetricExporter(endpoint=_signal_endpoint(endpoint, "metrics")),
            export_interval_millis=interval,
        )
        metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))

    tracer = trace.get_tracer("pipecat-mlx-voice", "0.1.0")
    meter = metrics.get_meter("pipecat-mlx-voice", "0.1.0")
    return Telemetry(
        service_name=service_name,
        tracer=tracer,
        meter=meter,
        operations=meter.create_counter(
            "pipecat.operation",
            unit="{operation}",
            description="Completed payload-free application operations",
        ),
        duration=meter.create_histogram(
            "pipecat.operation.duration",
            unit="s",
            description="Payload-free application operation duration",
        ),
    )
