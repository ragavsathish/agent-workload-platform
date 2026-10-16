"""Bounded, local-only replay storage for the selected input filter."""

from __future__ import annotations

import json
import os
import queue
import shutil
import threading
import wave
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Final
from uuid import UUID, uuid4

import numpy as np

KNOWN_DIAGNOSTIC_VARIANTS: Final = frozenset({"raw", "voxlock", "rnnoise"})
_SENTINEL: Final = object()


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class AudioDiagnosticSession:
    id: str
    started_at: str
    completed_at: str
    duration_seconds: float
    sample_rate: int
    selected_filter: str
    dropped_chunks: int
    truncated: bool
    variants: tuple[str, ...]

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
            "durationSeconds": round(self.duration_seconds, 3),
            "sampleRate": self.sample_rate,
            "selectedFilter": self.selected_filter,
            "droppedChunks": self.dropped_chunks,
            "truncated": self.truncated,
            "variants": list(self.variants),
            "metricsAvailable": True,
        }


class SessionAudioRecorder:
    """Write raw and selected-filter WAVs off the real-time audio path."""

    def __init__(
        self,
        store: AudioDiagnosticStore,
        *,
        sample_rate: int,
        selected_filter: str,
        max_seconds: int,
    ) -> None:
        self._store = store
        self.id = str(uuid4())
        self.sample_rate = sample_rate
        self.selected_filter = selected_filter
        if selected_filter not in KNOWN_DIAGNOSTIC_VARIANTS - {"raw"}:
            raise ValueError("unknown selected audio filter")
        self.variants = ("raw", selected_filter)
        self.started_at = _utc_now()
        self._max_frames = sample_rate * max_seconds
        self._raw_frames = 0
        self._dropped_chunks = 0
        self._truncated = False
        self._closed = False
        self._error: BaseException | None = None
        self._metrics: list[dict[str, object]] = []
        self._latest_waveform: list[dict[str, float | int]] = []
        self._snapshot_lock = threading.Lock()
        self._queue: queue.Queue[object] = queue.Queue(maxsize=256)
        self._temporary = store.root / f".active-{self.id}"
        self._temporary.mkdir(mode=0o700)
        self._thread = threading.Thread(
            target=self._write_loop,
            name=f"voice-diagnostics-{self.id}",
            daemon=True,
        )
        self._thread.start()

    def _write_loop(self) -> None:
        writers: dict[str, wave.Wave_write] = {}
        try:
            for variant in self.variants:
                target = self._temporary / f"{variant}.wav"
                writer = wave.open(str(target), "wb")
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(self.sample_rate)
                writers[variant] = writer
            while True:
                item = self._queue.get()
                if item is _SENTINEL:
                    break
                if not isinstance(item, dict):
                    continue
                for variant, audio in item.items():
                    if variant in writers and isinstance(audio, bytes) and audio:
                        writers[variant].writeframesraw(audio)
        except BaseException as exc:  # Diagnostics must never terminate voice processing.
            self._error = exc
        finally:
            for writer in writers.values():
                writer.close()

    def record(
        self,
        *,
        raw: bytes,
        filtered: bytes,
        metrics: dict[str, object] | None,
    ) -> None:
        if self._closed or self._truncated:
            return
        raw_frames = len(raw) // 2
        if self._raw_frames + raw_frames > self._max_frames:
            self._truncated = True
            return
        self._raw_frames += raw_frames
        with self._snapshot_lock:
            if metrics is not None:
                self._metrics.append(metrics)
            self._latest_waveform = _waveform_envelope(raw)
        try:
            self._queue.put_nowait({"raw": raw, self.selected_filter: filtered})
        except queue.Full:
            self._dropped_chunks += 1

    def close(self) -> AudioDiagnosticSession | None:
        if self._closed:
            return None
        self._closed = True
        self._queue.put(_SENTINEL)
        self._thread.join(timeout=10)
        if self._thread.is_alive():
            self._error = TimeoutError("audio diagnostic writer did not stop")
        if self._error is not None:
            shutil.rmtree(self._temporary, ignore_errors=True)
            self._store.deactivate(self.id)
            return None

        completed_at = _utc_now()
        session = AudioDiagnosticSession(
            id=self.id,
            started_at=self.started_at,
            completed_at=completed_at,
            duration_seconds=self._raw_frames / self.sample_rate,
            sample_rate=self.sample_rate,
            selected_filter=self.selected_filter,
            dropped_chunks=self._dropped_chunks,
            truncated=self._truncated,
            variants=self.variants,
        )
        metadata = self._temporary / "metadata.json"
        metadata.write_text(json.dumps(session.as_dict(), sort_keys=True), encoding="utf-8")
        metadata.chmod(0o600)
        metrics_path = self._temporary / "metrics.json"
        with self._snapshot_lock:
            metrics = list(self._metrics)
        metrics_path.write_text(
            json.dumps({"version": 1, "points": metrics}, separators=(",", ":")),
            encoding="utf-8",
        )
        metrics_path.chmod(0o600)
        for variant in self.variants:
            (self._temporary / f"{variant}.wav").chmod(0o600)
        os.replace(self._temporary, self._store.root / self.id)
        self._store.deactivate(self.id)
        self._store.prune()
        return session

    def snapshot(self) -> dict[str, object]:
        with self._snapshot_lock:
            point = dict(self._metrics[-1]) if self._metrics else None
            waveform = list(self._latest_waveform)
        return {
            "active": True,
            "id": self.id,
            "startedAt": self.started_at,
            "selectedFilter": self.selected_filter,
            "point": point,
            "waveform": waveform,
        }


class AudioDiagnosticStore:
    def __init__(self, root: Path, *, max_sessions: int = 5, max_seconds: int = 1800) -> None:
        if max_sessions < 1 or max_sessions > 20:
            raise ValueError("max_sessions must be between 1 and 20")
        if max_seconds < 1 or max_seconds > 7200:
            raise ValueError("max_seconds must be between 1 and 7200")
        self.root = root
        self.max_sessions = max_sessions
        self.max_seconds = max_seconds
        self._active: dict[str, SessionAudioRecorder] = {}
        self._active_lock = threading.Lock()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        root.chmod(0o700)
        for stale in root.glob(".active-*"):
            shutil.rmtree(stale, ignore_errors=True)

    def begin(self, *, sample_rate: int, selected_filter: str) -> SessionAudioRecorder:
        recorder = SessionAudioRecorder(
            self,
            sample_rate=sample_rate,
            selected_filter=selected_filter,
            max_seconds=self.max_seconds,
        )
        with self._active_lock:
            self._active[recorder.id] = recorder
        return recorder

    def deactivate(self, session_id: str) -> None:
        with self._active_lock:
            self._active.pop(session_id, None)

    def live_snapshot(self) -> dict[str, object]:
        with self._active_lock:
            active = list(self._active.values())
        if not active:
            return {"active": False, "point": None, "waveform": []}
        return max(active, key=lambda recorder: recorder.started_at).snapshot()

    def list(self) -> list[dict[str, object]]:
        sessions: list[dict[str, object]] = []
        for metadata in self.root.glob("*/metadata.json"):
            try:
                payload = json.loads(metadata.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(payload, dict) and isinstance(payload.get("completedAt"), str):
                sessions.append(payload)
        sessions.sort(key=lambda item: str(item["completedAt"]), reverse=True)
        return sessions[: self.max_sessions]

    def prune(self) -> None:
        completed = self.list()
        keep = {str(session["id"]) for session in completed[: self.max_sessions]}
        for directory in self.root.iterdir():
            if not directory.is_dir() or directory.name.startswith(".active-"):
                continue
            if directory.name not in keep:
                shutil.rmtree(directory)

    def audio_path(self, session_id: str, variant: str) -> Path:
        if variant not in KNOWN_DIAGNOSTIC_VARIANTS:
            raise ValueError("unknown audio diagnostic variant")
        canonical_id = str(UUID(session_id))
        target = self.root / canonical_id / f"{variant}.wav"
        if not target.is_file():
            raise FileNotFoundError(target)
        return target

    def metrics(self, session_id: str) -> dict[str, object]:
        canonical_id = str(UUID(session_id))
        target = self.root / canonical_id / "metrics.json"
        if not target.is_file():
            raise FileNotFoundError(target)
        payload = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("points"), list):
            raise ValueError("invalid audio diagnostic metrics")
        return payload


def _waveform_envelope(audio: bytes, bins: int = 64) -> list[dict[str, float | int]]:
    if not audio:
        return []
    samples = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768
    return [
        {
            "index": index,
            "min": round(float(group.min()), 4),
            "max": round(float(group.max()), 4),
        }
        for index, group in enumerate(np.array_split(samples, min(bins, len(samples))))
        if len(group)
    ]


@lru_cache(maxsize=1)
def audio_diagnostic_store() -> AudioDiagnosticStore:
    return AudioDiagnosticStore(
        Path(os.getenv("VOICE_DIAGNOSTIC_DIR", "/var/lib/voice-diagnostics")),
        max_sessions=int(os.getenv("VOICE_DIAGNOSTIC_MAX_SESSIONS", "5")),
        max_seconds=int(os.getenv("VOICE_DIAGNOSTIC_MAX_SECONDS", "1800")),
    )
