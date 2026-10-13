from pathlib import Path

WORKLOAD = Path(__file__).resolve().parents[2]


def test_transcription_path_has_no_speaker_gate() -> None:
    broker = (WORKLOAD / "server/inference_broker.py").read_text(encoding="utf-8")

    assert "speaker_verification" not in broker
    assert "_speaker_verifier" not in broker
    assert "_speaker_enrollment" not in broker


def test_edge_uses_plain_smart_turn_with_recommended_vad_threshold() -> None:
    edge = (WORKLOAD / "edge/bot.py").read_text(encoding="utf-8")

    assert "FilterIncompleteUserTurnStrategies" not in edge
    assert "UserTurnStrategies(" in edge
    assert "VADParams(stop_secs=0.2)" in edge


def test_deployment_has_no_speaker_verification_configuration() -> None:
    deployment_files = [
        WORKLOAD / "Makefile",
        WORKLOAD / "README.md",
        WORKLOAD / "server/.env.example",
        WORKLOAD / "scripts/install-launch-agents.sh",
    ]

    for path in deployment_files:
        assert "SPEAKER_" not in path.read_text(encoding="utf-8"), path
