from dataclasses import dataclass
from types import SimpleNamespace

import numpy as np

from voice_agent.speech.infrastructure import parakeet_stt


@dataclass
class StubModel:
    text: str

    def __post_init__(self) -> None:
        self.preprocessor_config = object()
        self.received_mel = None

    def generate(self, mel):
        self.received_mel = mel
        return [SimpleNamespace(text=self.text)]


def test_transcribes_pcm_with_one_cached_model(monkeypatch) -> None:
    model = StubModel("  In the current workspace.  ")
    loads: list[str] = []
    mel = object()
    monkeypatch.setattr(
        parakeet_stt,
        "from_pretrained",
        lambda model_id: loads.append(model_id) or model,
    )
    monkeypatch.setattr(parakeet_stt, "get_logmel", lambda audio, config: mel)
    parakeet_stt.load_model.cache_clear()

    audio = np.zeros(16_000, dtype=np.float32)
    first = parakeet_stt.transcribe_pcm(audio, model_id="parakeet-v3")
    second = parakeet_stt.transcribe_pcm(audio, model_id="parakeet-v3")

    assert first == {"text": "In the current workspace."}
    assert second == first
    assert loads == ["parakeet-v3"]
    assert model.received_mel is mel


def test_returns_empty_text_when_model_emits_no_alignment(monkeypatch) -> None:
    model = StubModel("")
    model.generate = lambda mel: []
    monkeypatch.setattr(parakeet_stt, "load_model", lambda model_id: model)
    monkeypatch.setattr(parakeet_stt, "get_logmel", lambda audio, config: object())

    assert parakeet_stt.transcribe_pcm(
        np.zeros(160, dtype=np.float32), model_id="parakeet-v3"
    ) == {"text": ""}
