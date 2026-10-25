"""Initialize explicit Docker secret files from the private environment file."""

from __future__ import annotations

import os
import secrets
import sys
import wave
from array import array
from pathlib import Path
from urllib.parse import quote

from dotenv import dotenv_values


def required(values: dict[str, str | None], name: str, minimum: int = 1) -> str:
    value = values.get(name) or ""
    if len(value) < minimum or value.startswith("replace-with-"):
        raise SystemExit(f"{name} must be configured in deploy/.env")
    return value


def materialize_voice_sample(source: Path, destination: Path) -> None:
    """Store only the loudest three seconds from the first fifteen seconds."""
    with wave.open(str(source), "rb") as sample:
        duration = sample.getnframes() / sample.getframerate()
        if (
            sample.getnchannels() != 1
            or sample.getsampwidth() != 2
            or sample.getframerate() != 16_000
            or duration < 3.0
        ):
            raise SystemExit(
                "VoxLock sample must be mono 16 kHz PCM16 WAV with at least 3 seconds"
            )
        pcm = array("h")
        pcm.frombytes(sample.readframes(min(sample.getnframes(), 15 * 16_000)))
    if sys.byteorder != "little":
        pcm.byteswap()

    frame_samples = 160
    window_frames = 300
    energies = [
        sum(value * value for value in pcm[offset : offset + frame_samples])
        for offset in range(0, len(pcm) - frame_samples + 1, frame_samples)
    ]
    rolling = sum(energies[:window_frames])
    best_energy = rolling
    best_frame = 0
    for index in range(window_frames, len(energies)):
        rolling += energies[index] - energies[index - window_frames]
        if rolling > best_energy:
            best_energy = rolling
            best_frame = index - window_frames + 1
    if best_energy <= 0:
        raise SystemExit("VoxLock sample contains no usable speech")

    start = best_frame * frame_samples
    selected = pcm[start : start + 3 * 16_000]
    temporary = destination.with_suffix(".wav.part")
    with wave.open(str(temporary), "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16_000)
        target.writeframes(selected.tobytes())
    temporary.replace(destination)
    os.chmod(destination, 0o600)


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    values = dotenv_values(root / "deploy/.env")
    broker = required(values, "INFERENCE_BROKER_TOKEN", 32)
    gateway = required(values, "AGENT_GATEWAY_TOKEN", 32)
    approval = required(values, "ORCHESTRATOR_APPROVAL_SECRET", 32)
    postgres = required(values, "POSTGRES_PASSWORD", 16)

    secrets_dir = root / "deploy/secrets"
    secrets_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    writer_token_path = secrets_dir / "digital-twin-writer-token"
    configured_writer_token = values.get("DIGITAL_TWIN_WRITER_TOKEN") or ""
    if configured_writer_token and not configured_writer_token.startswith("replace-with-"):
        writer_token = configured_writer_token
    elif writer_token_path.is_file():
        writer_token = writer_token_path.read_text(encoding="utf-8").strip()
    else:
        writer_token = secrets.token_urlsafe(32)
    reader_token_path = secrets_dir / "digital-twin-reader-token"
    configured_reader_token = values.get("DIGITAL_TWIN_READER_TOKEN") or ""
    if configured_reader_token and not configured_reader_token.startswith("replace-with-"):
        reader_token = configured_reader_token
    elif reader_token_path.is_file():
        reader_token = reader_token_path.read_text(encoding="utf-8").strip()
    else:
        reader_token = secrets.token_urlsafe(32)
    input_filter = (values.get("VOICE_INPUT_FILTER") or "rnnoise").strip().lower()
    if input_filter not in {"rnnoise", "voxlock"}:
        raise SystemExit("VOICE_INPUT_FILTER must be rnnoise or voxlock")
    sample_path = secrets_dir / "voxlock-voice-sample.wav"
    sample_source = values.get("VOXLOCK_VOICE_SAMPLE_SOURCE") or ""
    if sample_source:
        source = Path(sample_source).expanduser().resolve()
        if not source.is_file():
            raise SystemExit("VOXLOCK_VOICE_SAMPLE_SOURCE must be a readable WAV file")
        materialize_voice_sample(source, sample_path)
    elif input_filter == "voxlock" and not sample_path.is_file():
        raise SystemExit(
            "Set VOXLOCK_VOICE_SAMPLE_SOURCE or place the sample at "
            "deploy/secrets/voxlock-voice-sample.wav"
        )
    elif not sample_path.exists():
        sample_path.touch(mode=0o600)

    grafana_path = secrets_dir / "grafana-admin-password"
    configured_grafana = values.get("GRAFANA_ADMIN_PASSWORD") or ""
    if configured_grafana and not configured_grafana.startswith("replace-with-"):
        grafana = configured_grafana
    elif grafana_path.is_file():
        grafana = grafana_path.read_text(encoding="utf-8").strip()
    else:
        grafana = secrets.token_urlsafe(32)
    grafana_mcp_caller_path = secrets_dir / "grafana-mcp-caller-token"
    if grafana_mcp_caller_path.is_file():
        grafana_mcp_caller = grafana_mcp_caller_path.read_text(encoding="utf-8").strip()
    else:
        grafana_mcp_caller = secrets.token_urlsafe(32)
    gitea_path = secrets_dir / "gitea-admin-password"
    if gitea_path.is_file():
        gitea = gitea_path.read_text(encoding="utf-8").strip()
    else:
        gitea = secrets.token_urlsafe(32)
    gitea_agent_password_path = secrets_dir / "gitea-agent-password"
    if gitea_agent_password_path.is_file():
        gitea_agent_password = gitea_agent_password_path.read_text(encoding="utf-8").strip()
    else:
        gitea_agent_password = secrets.token_urlsafe(32)
    gitea_builder_password_path = secrets_dir / "gitea-builder-password"
    if gitea_builder_password_path.is_file():
        gitea_builder_password = gitea_builder_password_path.read_text(encoding="utf-8").strip()
    else:
        gitea_builder_password = secrets.token_urlsafe(32)
    gitea_dispatcher_password_path = secrets_dir / "gitea-dispatcher-password"
    if gitea_dispatcher_password_path.is_file():
        gitea_dispatcher_password = gitea_dispatcher_password_path.read_text(
            encoding="utf-8"
        ).strip()
    else:
        gitea_dispatcher_password = secrets.token_urlsafe(32)
    files = {
        "broker-token": broker,
        "agent-gateway-token": gateway,
        "digital-twin-reader-token": reader_token,
        "digital-twin-writer-token": writer_token,
        "approval-secret": approval,
        "postgres-password": postgres,
        "database-url": (
            f"postgresql://voice_agents:{quote(postgres, safe='')}@postgres:5432/voice_agents"
        ),
        "grafana-admin-password": grafana,
        "grafana-mcp-caller-token": grafana_mcp_caller,
        "gitea-admin-password": gitea,
        "gitea-agent-password": gitea_agent_password,
        "gitea-builder-password": gitea_builder_password,
        "gitea-dispatcher-password": gitea_dispatcher_password,
    }
    for name, value in files.items():
        path = secrets_dir / name
        content = value + "\n"
        if not path.is_file() or path.read_text(encoding="utf-8") != content:
            path.write_text(content, encoding="utf-8")
        os.chmod(path, 0o600)


if __name__ == "__main__":
    main()
