"""Bridge payload-free Pipecat observer events into application OTEL."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

from pipecat.observers.error_observer import ErrorObserver
from pipecat.observers.service_metrics_observer import ServiceMetricsObserver
from pipecat.observers.speaking_observer import SpeakingObserver
from pipecat.observers.turn_tracking_observer import TurnTrackingObserver
from pipecat.observers.user_bot_latency_observer import UserBotLatencyObserver


class PipecatTelemetryBridge:
    """Attach fixed-cardinality observer handlers to the edge telemetry.

    Observer payloads intentionally stay in Pipecat. Only event categories and
    numeric durations/counts cross this boundary; transcript, audio, prompts,
    processor/model names, identities, and exception text are discarded.
    """

    def __init__(
        self, telemetry: Any, record_diagnostic_event: Callable[[str], None] | None = None
    ) -> None:
        self._telemetry = telemetry
        self._record_diagnostic_event = record_diagnostic_event

    def observers(self) -> list[Any]:
        error = ErrorObserver()
        service = ServiceMetricsObserver()
        speaking = SpeakingObserver()
        turns = TurnTrackingObserver()
        latency = UserBotLatencyObserver()

        @error.event_handler("on_error")
        async def on_error(_observer: Any, _event: Any) -> None:
            self._telemetry.record("pipecat.error", outcome="error")

        @service.event_handler("on_service_latency")
        async def on_service_latency(_observer: Any, record: Any) -> None:
            kind = getattr(getattr(record, "kind", None), "value", "unknown")
            if kind not in {"ttfb", "ttfa", "ttfat"}:
                kind = "unknown"
            self._telemetry.record(
                f"pipecat.service_latency.{kind}",
                duration_seconds=float(record.seconds),
            )

        @service.event_handler("on_service_usage")
        async def on_service_usage(_observer: Any, record: Any) -> None:
            kind = getattr(getattr(record, "kind", None), "value", "unknown")
            if kind not in {"stt", "llm", "tts"}:
                kind = "unknown"
            self._telemetry.record(f"pipecat.service_usage.{kind}")

        @speaking.event_handler("on_speech_event")
        async def on_speech_event(_observer: Any, event: Any) -> None:
            kind = getattr(getattr(event, "kind", None), "value", "unknown")
            if kind not in {
                "user_speech_started",
                "user_speech_stopped",
                "user_turn_started",
                "user_turn_stopped",
                "bot_speech_started",
                "bot_speech_stopped",
                "interruption",
            }:
                kind = "unknown"
            self._telemetry.record(f"pipecat.speech.{kind}")
            if kind in {"bot_speech_started", "bot_speech_stopped", "interruption"}:
                if self._record_diagnostic_event is not None:
                    self._record_diagnostic_event(kind)

        @turns.event_handler("on_turn_started")
        async def on_turn_started(_observer: Any, _turn_number: int) -> None:
            self._telemetry.record("pipecat.turn.started")

        @turns.event_handler("on_turn_ended")
        async def on_turn_ended(
            _observer: Any, _turn_number: int, duration: float, was_interrupted: bool
        ) -> None:
            self._telemetry.record(
                "pipecat.turn.interrupted" if was_interrupted else "pipecat.turn.completed",
                duration_seconds=float(duration),
            )

        @latency.event_handler("on_latency_measured")
        async def on_latency_measured(_observer: Any, seconds: float) -> None:
            self._telemetry.record("pipecat.user_bot_latency", duration_seconds=float(seconds))

        @latency.event_handler("on_first_bot_speech_latency")
        async def on_first_bot_speech_latency(_observer: Any, seconds: float) -> None:
            self._telemetry.record(
                "pipecat.first_bot_speech_latency", duration_seconds=float(seconds)
            )

        @latency.event_handler("on_latency_breakdown")
        async def on_latency_breakdown(_observer: Any, breakdown: Any) -> None:
            total = float(getattr(breakdown, "total_secs", 0.0))
            self._telemetry.record("pipecat.latency_breakdown", duration_seconds=total)

        return [error, service, speaking, turns, latency]


def configure_pipecat_observers(
    telemetry: Any, record_diagnostic_event: Callable[[str], None] | None = None
) -> Sequence[Any]:
    """Return Pipecat observers connected to the app telemetry."""
    return PipecatTelemetryBridge(telemetry, record_diagnostic_event).observers()
