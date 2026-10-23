import asyncio
import unittest
from unittest.mock import MagicMock, patch

import numpy as np
from pipecat.audio.vad.vad_analyzer import VADParams

from diagnostic_vad import DiagnosticSileroVADAnalyzer


class DiagnosticVADTest(unittest.TestCase):
    def test_records_silero_samples_and_speech_edges_on_audio_clock(self):
        input_filter = MagicMock()
        with patch("pipecat.audio.vad.silero.SileroOnnxModel") as model_type:
            model = model_type.return_value
            model.return_value = np.array([0.9])
            analyzer = DiagnosticSileroVADAnalyzer(
                input_filter,
                params=VADParams(start_secs=0.064, stop_secs=0.064, min_volume=0),
            )
        analyzer.set_sample_rate(16_000)
        chunk = b"\x00\x00" * 512

        async def run() -> None:
            await analyzer.analyze_audio(chunk)
            await analyzer.analyze_audio(chunk)
            model.return_value = np.array([0.1])
            await analyzer.analyze_audio(chunk)
            await analyzer.analyze_audio(chunk)
            await analyzer.cleanup()

        asyncio.run(run())

        self.assertEqual(input_filter.record_vad_sample.call_count, 4)
        self.assertEqual(input_filter.record_vad_sample.call_args_list[0].args[1], 0.9)
        self.assertEqual(
            [call.args for call in input_filter.record_event.call_args_list],
            [("vad_speech_started", 0.064), ("vad_speech_stopped", 0.128)],
        )


if __name__ == "__main__":
    unittest.main()
