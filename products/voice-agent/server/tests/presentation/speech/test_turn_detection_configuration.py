from pathlib import Path

VOICE_AGENT = Path(__file__).resolve().parents[4]


def test_transcription_path_has_no_speaker_gate() -> None:
    broker = (VOICE_AGENT / "server/src/voice_agent/speech/presentation/http.py").read_text(
        encoding="utf-8"
    )

    assert "speaker_verification" not in broker
    assert "_speaker_verifier" not in broker
    assert "_speaker_enrollment" not in broker


def test_edge_uses_plain_smart_turn_with_recommended_vad_threshold() -> None:
    edge = (VOICE_AGENT / "edge/bot.py").read_text(encoding="utf-8")

    assert "FilterIncompleteUserTurnStrategies" not in edge
    assert "UserTurnStrategies(" in edge
    assert "VADParams(stop_secs=0.2)" in edge


def test_edge_filters_noise_before_turn_detection() -> None:
    edge = (VOICE_AGENT / "edge/bot.py").read_text(encoding="utf-8")
    dependencies = (VOICE_AGENT / "edge/pyproject.toml").read_text(encoding="utf-8")

    assert "from pipecat.audio.filters.rnnoise_filter import RNNoiseFilter" in edge
    assert "audio_in_filter=RNNoiseFilter()" in edge
    assert "rnnoise" in dependencies


def test_deployment_has_no_speaker_verification_configuration() -> None:
    deployment_files = [
        VOICE_AGENT / "Makefile",
        VOICE_AGENT / "README.md",
        VOICE_AGENT / "server/.env.example",
        VOICE_AGENT / "scripts/install-launch-agents.sh",
    ]

    for path in deployment_files:
        assert "SPEAKER_" not in path.read_text(encoding="utf-8"), path
