import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

from audio_filter import load_owner_voice_sample, selected_filter_name


def write_sample(path: Path, seconds: float, amplitude: int = 2_000) -> None:
    samples = np.full(round(seconds * 16_000), amplitude, dtype=np.int16)
    with wave.open(str(path), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(samples.tobytes())


class AudioFilterTest(unittest.TestCase):
    def tearDown(self):
        load_owner_voice_sample.cache_clear()

    def test_filter_selection_is_allowlisted(self):
        with patch.dict(os.environ, {"VOICE_INPUT_FILTER": "VOXLOCK"}):
            self.assertEqual(selected_filter_name(), "voxlock")

        with patch.dict(os.environ, {"VOICE_INPUT_FILTER": "unknown"}):
            with self.assertRaisesRegex(RuntimeError, "must be one of"):
                selected_filter_name()

    def test_owner_sample_is_reduced_to_three_seconds(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "owner.wav"
            write_sample(path, 6.0)

            sample = load_owner_voice_sample(path)

        self.assertEqual(sample.dtype, np.float32)
        self.assertEqual(len(sample), 48_000)
        self.assertFalse(sample.flags.writeable)

    def test_owner_sample_rejects_short_or_silent_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            short = Path(directory) / "short.wav"
            silent = Path(directory) / "silent.wav"
            write_sample(short, 2.9)
            write_sample(silent, 3.1, amplitude=0)

            with self.assertRaisesRegex(RuntimeError, "at least three seconds"):
                load_owner_voice_sample(short)
            with self.assertRaisesRegex(RuntimeError, "no usable speech"):
                load_owner_voice_sample(silent)


if __name__ == "__main__":
    unittest.main()
