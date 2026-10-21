import stat
import wave
from array import array
from pathlib import Path

import pytest

from tools.config.init_secrets import materialize_voice_sample


def write_wav(path: Path, samples: array, channels: int = 1) -> None:
    with wave.open(str(path), "wb") as target:
        target.setnchannels(channels)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(samples.tobytes())


def test_materializes_strongest_three_seconds_as_private_secret(tmp_path: Path):
    source = tmp_path / "source.wav"
    destination = tmp_path / "secret.wav"
    quiet = array("h", [100]) * (3 * 16_000)
    loud = array("h", [3_000]) * (3 * 16_000)
    write_wav(source, quiet + loud)

    materialize_voice_sample(source, destination)

    with wave.open(str(destination), "rb") as sample:
        selected = array("h")
        selected.frombytes(sample.readframes(sample.getnframes()))
        assert sample.getnchannels() == 1
        assert sample.getsampwidth() == 2
        assert sample.getframerate() == 16_000
        assert sample.getnframes() == 3 * 16_000
    assert min(selected) == 3_000
    assert stat.S_IMODE(destination.stat().st_mode) == 0o600


def test_rejects_silent_sample(tmp_path: Path):
    source = tmp_path / "silent.wav"
    write_wav(source, array("h", [0]) * (3 * 16_000))

    with pytest.raises(SystemExit, match="no usable speech"):
        materialize_voice_sample(source, tmp_path / "secret.wav")


def test_rejects_non_mono_sample(tmp_path: Path):
    source = tmp_path / "stereo.wav"
    write_wav(source, array("h", [1_000]) * (6 * 16_000), channels=2)

    with pytest.raises(SystemExit, match="mono 16 kHz PCM16"):
        materialize_voice_sample(source, tmp_path / "secret.wav")
