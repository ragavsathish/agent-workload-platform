from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import numpy as np
import pytest

import speaker_verification
from speaker_verification import (
    BrowserEnrollmentCoordinator,
    SpeakerVerificationSettings,
    SpeakerVerifier,
    begin_browser_enrollment,
    load_profile,
    save_profile,
)


class FakeStream:
    def __init__(self) -> None:
        self.waveform = np.array([], dtype=np.float32)

    def accept_waveform(self, *, sample_rate: int, waveform: np.ndarray) -> None:
        assert sample_rate == 16_000
        self.waveform = waveform

    def input_finished(self) -> None:
        pass


class FakeExtractor:
    dim = 2

    def __init__(self, embedding: list[float]) -> None:
        self.embedding = embedding

    def create_stream(self) -> FakeStream:
        return FakeStream()

    def is_ready(self, stream: FakeStream) -> bool:
        return bool(stream.waveform.size)

    def compute(self, stream: FakeStream) -> list[float]:
        assert stream.waveform.size
        return self.embedding


def settings(tmp_path: Path, *, threshold: float = 0.6) -> SpeakerVerificationSettings:
    return SpeakerVerificationSettings(
        enabled=True,
        model_path=tmp_path / "model.onnx",
        profile_path=tmp_path / "owner.json",
        threshold=threshold,
        minimum_seconds=1.5,
        model_sha256="a" * 64,
    )


def test_rejects_audio_shorter_than_minimum(tmp_path: Path) -> None:
    verifier = SpeakerVerifier(
        settings(tmp_path), FakeExtractor([1.0, 0.0]), np.array([1.0, 0.0])
    )
    result = verifier.verify(np.zeros(23_999, dtype=np.float32))
    assert not result.accepted
    assert result.score is None
    assert result.reason == "audio_too_short"


@pytest.mark.parametrize(("embedding", "accepted"), [([0.8, 0.6], True), ([0.0, 1.0], False)])
def test_compares_normalized_embeddings(
    tmp_path: Path, embedding: list[float], accepted: bool
) -> None:
    verifier = SpeakerVerifier(
        settings(tmp_path), FakeExtractor(embedding), np.array([10.0, 0.0])
    )
    assert verifier.verify(np.zeros(24_000, dtype=np.float32)).accepted is accepted


def test_profile_is_private_and_bound_to_model(tmp_path: Path) -> None:
    configured = settings(tmp_path)
    save_profile(
        configured.profile_path,
        np.array([3.0, 4.0]),
        model_sha256=configured.model_sha256,
        dimension=2,
    )
    loaded = load_profile(configured, 2)
    assert np.allclose(loaded, np.array([0.6, 0.8]))
    assert stat.S_IMODE(configured.profile_path.stat().st_mode) == 0o600
    assert json.loads(configured.profile_path.read_text())["model_sha256"] == "a" * 64


def test_profile_rejects_broad_permissions(tmp_path: Path) -> None:
    configured = settings(tmp_path)
    save_profile(
        configured.profile_path,
        np.array([1.0, 0.0]),
        model_sha256=configured.model_sha256,
        dimension=2,
    )
    os.chmod(configured.profile_path, 0o644)
    with pytest.raises(RuntimeError, match="permissions"):
        load_profile(configured, 2)


def test_profile_rejects_wrong_model_binding(tmp_path: Path) -> None:
    configured = settings(tmp_path)
    save_profile(
        configured.profile_path,
        np.array([1.0, 0.0]),
        model_sha256="b" * 64,
        dimension=2,
    )
    with pytest.raises(RuntimeError, match="not bound"):
        load_profile(configured, 2)


def test_browser_enrollment_consumes_token_and_three_turns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured = settings(tmp_path)
    request_path = tmp_path / "enrollment.json"
    monkeypatch.setenv("SPEAKER_ENROLLMENT_REQUEST_PATH", str(request_path))
    monkeypatch.setattr(
        speaker_verification, "load_extractor", lambda _: FakeExtractor([1.0, 0.0])
    )
    token = begin_browser_enrollment()
    coordinator = BrowserEnrollmentCoordinator(configured)

    session = coordinator.claim(token)
    captures = [
        coordinator.capture(np.zeros(32_000, dtype=np.float32)) for _ in range(3)
    ]

    assert [capture.samples for capture in captures] == [1, 2, 3]
    assert captures[-1].status == "complete"
    assert coordinator.status(session)["status"] == "complete"
    assert configured.profile_path.is_file()
    assert not request_path.exists()


def test_browser_enrollment_rejects_wrong_token(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    configured = settings(tmp_path)
    monkeypatch.setenv("SPEAKER_ENROLLMENT_REQUEST_PATH", str(tmp_path / "enrollment.json"))
    begin_browser_enrollment()

    with pytest.raises(RuntimeError, match="invalid or expired"):
        BrowserEnrollmentCoordinator(configured).claim("x" * 24)
