"""Fail-closed, host-local owner-speaker verification."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import stat
import threading
import time
import wave
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Protocol

import numpy as np

MODEL_FILENAME = "wespeaker_en_voxceleb_CAM++.onnx"
MODEL_SHA256 = "c46fad10b5f81e1aa4a60c162714208577093655076c5450f8c469e522ec54ef"
PROFILE_VERSION = 1
MAX_PROFILE_BYTES = 1_048_576


class EmbeddingStream(Protocol):
    def accept_waveform(self, *, sample_rate: int, waveform: np.ndarray) -> None: ...
    def input_finished(self) -> None: ...


class EmbeddingExtractor(Protocol):
    dim: int

    def create_stream(self) -> EmbeddingStream: ...
    def is_ready(self, stream: EmbeddingStream) -> bool: ...
    def compute(self, stream: EmbeddingStream) -> list[float]: ...


@dataclass(frozen=True)
class SpeakerVerificationSettings:
    enabled: bool
    model_path: Path
    profile_path: Path
    threshold: float = 0.60
    minimum_seconds: float = 1.5
    enrollment_consistency: float = 0.45
    model_sha256: str = MODEL_SHA256

    @classmethod
    def from_environment(cls) -> SpeakerVerificationSettings:
        enabled = os.getenv("SPEAKER_VERIFICATION_ENABLED", "false").strip().lower()
        if enabled not in {"true", "false"}:
            raise RuntimeError("SPEAKER_VERIFICATION_ENABLED must be true or false")
        root = Path.home() / "Library/Application Support/PipecatEdge"
        result = cls(
            enabled=enabled == "true",
            model_path=Path(os.getenv(
                "SPEAKER_MODEL_PATH", str(root / "models/speaker" / MODEL_FILENAME)
            )),
            profile_path=Path(os.getenv(
                "SPEAKER_PROFILE_PATH", str(root / "speaker/owner-profile.json")
            )),
            threshold=float(os.getenv("SPEAKER_VERIFICATION_THRESHOLD", "0.60")),
            minimum_seconds=float(os.getenv("SPEAKER_MINIMUM_SECONDS", "1.5")),
            enrollment_consistency=float(
                os.getenv("SPEAKER_ENROLLMENT_CONSISTENCY", "0.45")
            ),
            model_sha256=os.getenv("SPEAKER_MODEL_SHA256", MODEL_SHA256).lower(),
        )
        result.validate_values()
        return result

    def validate_values(self) -> None:
        if not 0.0 < self.threshold < 1.0:
            raise RuntimeError("SPEAKER_VERIFICATION_THRESHOLD must be between zero and one")
        if not 0.5 <= self.minimum_seconds <= 10.0:
            raise RuntimeError("SPEAKER_MINIMUM_SECONDS must be between 0.5 and 10")
        if not 0.0 < self.enrollment_consistency < 1.0:
            raise RuntimeError("SPEAKER_ENROLLMENT_CONSISTENCY must be between zero and one")
        if len(self.model_sha256) != 64 or any(
            character not in "0123456789abcdef" for character in self.model_sha256
        ):
            raise RuntimeError("SPEAKER_MODEL_SHA256 must be a lowercase SHA-256 digest")


@dataclass(frozen=True)
class VerificationResult:
    accepted: bool
    score: float | None
    reason: str


@dataclass(frozen=True)
class EnrollmentCapture:
    handled: bool
    status: str
    samples: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_regular_file(path: Path, label: str) -> None:
    if not path.is_absolute():
        raise RuntimeError(f"{label} path must be absolute")
    try:
        metadata = path.lstat()
    except FileNotFoundError as exc:
        raise RuntimeError(f"{label} does not exist") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise RuntimeError(f"{label} must be a regular file, not a symbolic link")
    if metadata.st_uid != os.getuid():
        raise RuntimeError(f"{label} must be owned by the broker user")


def validate_model(settings: SpeakerVerificationSettings) -> None:
    _validate_regular_file(settings.model_path, "speaker model")
    if _sha256(settings.model_path) != settings.model_sha256:
        raise RuntimeError("speaker model digest does not match the pinned artifact")


def _normalize(value: Any, dimension: int | None = None) -> np.ndarray:
    embedding = np.asarray(value, dtype=np.float32)
    if embedding.ndim != 1 or embedding.size == 0:
        raise RuntimeError("speaker embedding must be a non-empty vector")
    if dimension is not None and embedding.size != dimension:
        raise RuntimeError("speaker profile dimension does not match the model")
    if not np.all(np.isfinite(embedding)):
        raise RuntimeError("speaker embedding contains a non-finite value")
    magnitude = float(np.linalg.norm(embedding))
    if magnitude <= 1e-8:
        raise RuntimeError("speaker embedding has zero magnitude")
    return np.ascontiguousarray(embedding / magnitude, dtype=np.float32)


def load_profile(settings: SpeakerVerificationSettings, dimension: int) -> np.ndarray:
    _validate_regular_file(settings.profile_path, "speaker profile")
    metadata = settings.profile_path.stat()
    if metadata.st_mode & 0o077:
        raise RuntimeError("speaker profile permissions must be 0600 or stricter")
    if metadata.st_size > MAX_PROFILE_BYTES:
        raise RuntimeError("speaker profile is too large")
    try:
        payload = json.loads(settings.profile_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("speaker profile is invalid") from exc
    if (
        not isinstance(payload, dict)
        or payload.get("version") != PROFILE_VERSION
        or payload.get("model_sha256") != settings.model_sha256
        or not isinstance(payload.get("embedding"), list)
    ):
        raise RuntimeError("speaker profile is not bound to the configured model")
    return _normalize(payload["embedding"], dimension)


def save_profile(path: Path, embedding: np.ndarray, *, model_sha256: str, dimension: int) -> None:
    if not path.is_absolute():
        raise RuntimeError("speaker profile path must be absolute")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise RuntimeError("speaker profile directory must not be a symbolic link")
    os.chmod(path.parent, 0o700)
    payload = {
        "version": PROFILE_VERSION,
        "model_sha256": model_sha256,
        "embedding": _normalize(embedding, dimension).tolist(),
    }
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(payload, destination, separators=(",", ":"))
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def _write_private_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise RuntimeError("enrollment directory must not be a symbolic link")
    os.chmod(path.parent, 0o700)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
            json.dump(payload, destination, separators=(",", ":"))
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        temporary.unlink(missing_ok=True)


def enrollment_request_path() -> Path:
    default = Path.home() / "Library/Application Support/PipecatEdge/speaker/enrollment.json"
    return Path(os.getenv("SPEAKER_ENROLLMENT_REQUEST_PATH", str(default)))


def begin_browser_enrollment(*, lifetime_seconds: int = 600) -> str:
    if not 60 <= lifetime_seconds <= 900:
        raise RuntimeError("enrollment lifetime must be between 60 and 900 seconds")
    token = secrets.token_urlsafe(24)
    _write_private_json(
        enrollment_request_path(),
        {
            "version": 1,
            "token_sha256": hashlib.sha256(token.encode()).hexdigest(),
            "expires_at": int(time.time()) + lifetime_seconds,
        },
    )
    return token


class BrowserEnrollmentCoordinator:
    """Consumes one host-created token and diverts exactly three Pipecat turns."""

    def __init__(self, settings: SpeakerVerificationSettings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._extractor: EmbeddingExtractor | None = None
        self._session_hash: str | None = None
        self._expires_at = 0.0
        self._status = "inactive"
        self._samples: list[np.ndarray] = []
        self._message: str | None = None

    def claim(self, token: str) -> str:
        if not 16 <= len(token) <= 128:
            raise RuntimeError("invalid enrollment token")
        request_path = enrollment_request_path()
        _validate_regular_file(request_path, "enrollment request")
        metadata = request_path.stat()
        if metadata.st_mode & 0o077 or metadata.st_size > 4096:
            raise RuntimeError("enrollment request is not private")
        try:
            request = json.loads(request_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("invalid enrollment request") from exc
        supplied = hashlib.sha256(token.encode()).hexdigest()
        if (
            not isinstance(request, dict)
            or request.get("version") != 1
            or not isinstance(request.get("token_sha256"), str)
            or not secrets.compare_digest(supplied, request["token_sha256"])
            or not isinstance(request.get("expires_at"), int)
            or request["expires_at"] < int(time.time())
        ):
            raise RuntimeError("invalid or expired enrollment token")
        extractor = load_extractor(self.settings)
        session = secrets.token_urlsafe(32)
        with self._lock:
            self._extractor = extractor
            self._session_hash = hashlib.sha256(session.encode()).hexdigest()
            self._expires_at = min(float(request["expires_at"]), time.time() + 600)
            self._status = "collecting"
            self._samples = []
            self._message = None
            request_path.unlink()
        return session

    def capture(self, audio: np.ndarray, *, sample_rate: int = 16_000) -> EnrollmentCapture:
        with self._lock:
            if self._status != "collecting" or time.time() >= self._expires_at:
                if self._status == "collecting":
                    self._status = "expired"
                return EnrollmentCapture(False, self._status, len(self._samples))
            extractor = self._extractor
            if extractor is None:
                raise RuntimeError("enrollment extractor is unavailable")
            if audio.size < int(sample_rate * 2.0):
                self._message = "Speak for at least two seconds."
                return EnrollmentCapture(True, self._status, len(self._samples))
            embedding = compute_embedding(extractor, audio, sample_rate=sample_rate)
            self._samples.append(embedding)
            if len(self._samples) < 3:
                self._message = None
                return EnrollmentCapture(True, self._status, len(self._samples))
            similarities = [
                float(np.dot(left, right))
                for index, left in enumerate(self._samples)
                for right in self._samples[index + 1 :]
            ]
            if min(similarities) < self.settings.enrollment_consistency:
                self._status = "failed"
                self._message = "The three samples were not consistently from one speaker."
                return EnrollmentCapture(True, self._status, len(self._samples))
            owner = _normalize(np.mean(self._samples, axis=0), extractor.dim)
            save_profile(
                self.settings.profile_path,
                owner,
                model_sha256=self.settings.model_sha256,
                dimension=extractor.dim,
            )
            self._status = "complete"
            self._message = None
            return EnrollmentCapture(True, self._status, len(self._samples))

    def status(self, session: str) -> dict[str, Any]:
        supplied = hashlib.sha256(session.encode()).hexdigest()
        with self._lock:
            if self._session_hash is None or not secrets.compare_digest(
                supplied, self._session_hash
            ):
                raise RuntimeError("invalid enrollment session")
            if self._status == "collecting" and time.time() >= self._expires_at:
                self._status = "expired"
            return {
                "status": self._status,
                "samples": len(self._samples),
                "requiredSamples": 3,
                "message": self._message,
            }


def load_extractor(settings: SpeakerVerificationSettings) -> EmbeddingExtractor:
    validate_model(settings)
    try:
        import sherpa_onnx
    except ImportError as exc:
        raise RuntimeError("sherpa-onnx is required for speaker verification") from exc
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
        model=str(settings.model_path), num_threads=1, debug=False, provider="cpu"
    )
    if not config.validate():
        raise RuntimeError("speaker embedding model configuration is invalid")
    return sherpa_onnx.SpeakerEmbeddingExtractor(config)


def compute_embedding(
    extractor: EmbeddingExtractor, audio: np.ndarray, *, sample_rate: int = 16_000
) -> np.ndarray:
    waveform = np.ascontiguousarray(audio, dtype=np.float32)
    if waveform.ndim != 1 or not np.all(np.isfinite(waveform)):
        raise RuntimeError("speaker audio must be a finite mono waveform")
    stream = extractor.create_stream()
    stream.accept_waveform(sample_rate=sample_rate, waveform=waveform)
    stream.input_finished()
    if not extractor.is_ready(stream):
        raise RuntimeError("speaker model rejected the audio duration")
    return _normalize(extractor.compute(stream), extractor.dim)


class SpeakerVerifier:
    def __init__(
        self,
        settings: SpeakerVerificationSettings,
        extractor: EmbeddingExtractor,
        owner_embedding: np.ndarray,
    ) -> None:
        self.settings = settings
        self.extractor = extractor
        self.owner_embedding = _normalize(owner_embedding, extractor.dim)

    @classmethod
    def load(cls, settings: SpeakerVerificationSettings) -> SpeakerVerifier:
        extractor = load_extractor(settings)
        return cls(settings, extractor, load_profile(settings, extractor.dim))

    def verify(self, audio: np.ndarray, *, sample_rate: int = 16_000) -> VerificationResult:
        if audio.size < int(sample_rate * self.settings.minimum_seconds):
            return VerificationResult(False, None, "audio_too_short")
        embedding = compute_embedding(self.extractor, audio, sample_rate=sample_rate)
        score = float(np.dot(self.owner_embedding, embedding))
        accepted = score >= self.settings.threshold
        return VerificationResult(
            accepted, score, "owner_match" if accepted else "speaker_mismatch"
        )


def load_enabled_verifier() -> SpeakerVerifier | None:
    settings = SpeakerVerificationSettings.from_environment()
    return SpeakerVerifier.load(settings) if settings.enabled else None


def decode_enrollment_wav(path: Path) -> np.ndarray:
    try:
        with wave.open(BytesIO(path.read_bytes()), "rb") as source:
            if (
                source.getnchannels() != 1
                or source.getsampwidth() != 2
                or source.getframerate() != 16_000
            ):
                raise RuntimeError("enrollment WAV must be mono PCM16 at 16 kHz")
            frames = source.getnframes()
            if not 32_000 <= frames <= 480_000:
                raise RuntimeError("each enrollment WAV must be between 2 and 30 seconds")
            raw = source.readframes(frames)
    except (OSError, wave.Error, EOFError) as exc:
        raise RuntimeError(f"invalid enrollment WAV: {path}") from exc
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def enroll(settings: SpeakerVerificationSettings, recordings: list[Path]) -> None:
    if len(recordings) < 3:
        raise RuntimeError("at least three enrollment WAV files are required")
    extractor = load_extractor(settings)
    embeddings = [compute_embedding(extractor, decode_enrollment_wav(path)) for path in recordings]
    pairwise = [
        float(np.dot(left, right))
        for index, left in enumerate(embeddings)
        for right in embeddings[index + 1 :]
    ]
    if min(pairwise) < settings.enrollment_consistency:
        raise RuntimeError("enrollment samples are not sufficiently consistent")
    save_profile(
        settings.profile_path,
        _normalize(np.mean(embeddings, axis=0), extractor.dim),
        model_sha256=settings.model_sha256,
        dimension=extractor.dim,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the owner-speaker profile")
    parser.add_argument("command", choices=["begin", "enroll", "verify"])
    parser.add_argument("recordings", nargs="*", type=Path)
    arguments = parser.parse_args()
    from dotenv import load_dotenv

    load_dotenv(os.getenv("INFERENCE_BROKER_ENV_FILE", ".env"), override=True)
    settings = SpeakerVerificationSettings.from_environment()
    if arguments.command == "begin":
        if arguments.recordings:
            parser.error("begin does not accept WAV files")
        print(begin_browser_enrollment())
        return
    if arguments.command == "enroll":
        enroll(settings, arguments.recordings)
        print(f"Owner profile written to {settings.profile_path}")
        return
    if len(arguments.recordings) != 1:
        parser.error("verify requires exactly one WAV file")
    verifier = SpeakerVerifier.load(settings)
    result = verifier.verify(decode_enrollment_wav(arguments.recordings[0]))
    outcome = "accepted" if result.accepted else "rejected"
    score = "not-scored" if result.score is None else f"{result.score:.4f}"
    print(f"{outcome}: score={score} threshold={settings.threshold:.4f} reason={result.reason}")


if __name__ == "__main__":
    main()
