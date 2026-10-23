import tempfile
import unittest
import wave
from pathlib import Path
from typing import cast

import numpy as np

from audio_diagnostics import AudioDiagnosticStore


class AudioDiagnosticStoreTest(unittest.TestCase):
    def test_writes_raw_and_selected_filter_wavs(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AudioDiagnosticStore(Path(directory), max_sessions=5, max_seconds=10)
            recorder = store.begin(sample_rate=16_000, selected_filter="voxlock")
            recorder.record(
                raw=b"\x01\x00" * 160,
                filtered=b"\x02\x00" * 80,
                metrics={"timeSeconds": 0.01, "voxlockLatencyMs": 2.5},
            )
            recorder.record_vad_sample(0.01, np.float32(0.83), np.float32(0.71))
            recorder.record_event("vad_speech_started", 0.01)

            session = recorder.close()

            self.assertIsNotNone(session)
            self.assertEqual(len(store.list()), 1)
            payload = store.metrics(recorder.id)
            points = cast(list[dict[str, object]], payload["points"])
            self.assertEqual(points[0]["voxlockLatencyMs"], 2.5)
            self.assertEqual(payload["vadSamples"], [
                {"timeSeconds": 0.01, "confidence": 0.83, "volume": 0.71}
            ])
            self.assertEqual(payload["events"], [
                {"kind": "vad_speech_started", "timeSeconds": 0.01}
            ])
            self.assertEqual(store.list()[0]["variants"], ["raw", "voxlock"])
            for variant, expected_frames in (("raw", 160), ("voxlock", 80)):
                with wave.open(str(store.audio_path(recorder.id, variant)), "rb") as replay:
                    self.assertEqual(replay.getnchannels(), 1)
                    self.assertEqual(replay.getsampwidth(), 2)
                    self.assertEqual(replay.getframerate(), 16_000)
                    self.assertEqual(replay.getnframes(), expected_frames)

    def test_keeps_only_five_completed_sessions(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AudioDiagnosticStore(Path(directory), max_sessions=5, max_seconds=10)
            ids: list[str] = []
            for index in range(6):
                recorder = store.begin(sample_rate=16_000, selected_filter="rnnoise")
                recorder.record(
                    raw=index.to_bytes(2, "little") * 10,
                    filtered=b"\x00\x00" * 10,
                    metrics={"timeSeconds": index / 10},
                )
                self.assertIsNotNone(recorder.close())
                ids.append(recorder.id)

            listed = store.list()

            self.assertEqual(len(listed), 5)
            self.assertFalse((store.root / ids[0]).exists())
            self.assertTrue((store.root / ids[-1]).exists())

    def test_rejects_unknown_paths_and_truncates_at_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AudioDiagnosticStore(Path(directory), max_sessions=5, max_seconds=1)
            recorder = store.begin(sample_rate=10, selected_filter="voxlock")
            recorder.record(
                raw=b"\x00\x00" * 10,
                filtered=b"",
                metrics={"timeSeconds": 1},
            )
            recorder.record(
                raw=b"\x00\x00",
                filtered=b"",
                metrics={"timeSeconds": 1.1},
            )
            session = recorder.close()

            self.assertIsNotNone(session)
            assert session is not None
            self.assertTrue(session.truncated)
            with self.assertRaises(ValueError):
                store.audio_path(recorder.id, "../../raw")
            with self.assertRaises(ValueError):
                store.audio_path("not-a-uuid", "raw")

    def test_live_snapshot_contains_only_an_envelope_and_latest_metrics(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AudioDiagnosticStore(Path(directory), max_sessions=5, max_seconds=10)
            recorder = store.begin(sample_rate=16_000, selected_filter="voxlock")
            recorder.record(
                raw=b"\x00\x80\xff\x7f" * 64,
                filtered=b"",
                metrics={"timeSeconds": 0.1, "rawDbfs": -3.0},
            )

            snapshot = store.live_snapshot()

            self.assertTrue(snapshot["active"])
            point = cast(dict[str, object], snapshot["point"])
            waveform = cast(list[dict[str, object]], snapshot["waveform"])
            self.assertEqual(point["rawDbfs"], -3.0)
            self.assertEqual(len(waveform), 64)
            self.assertNotIn("audio", snapshot)
            recorder.close()
            self.assertFalse(store.live_snapshot()["active"])


if __name__ == "__main__":
    unittest.main()
