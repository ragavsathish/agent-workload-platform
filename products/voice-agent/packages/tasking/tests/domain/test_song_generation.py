import json

import pytest
from voice_agent.tasking.domain.song_generation import (
    lyric_prompt,
    manifest_from_pi_result,
    validate_song_manifest,
)


def manifest() -> dict[str, object]:
    return {
        "title": "Signals After Midnight",
        "style": "Warm contemporary R&B with Rhodes and layered harmonies",
        "lyrics": "[Verse 1]\nSignals cross the wire.\n\n[Chorus]\nShow me the trace.",
        "durationSeconds": 120,
        "bpm": 82,
        "keyScale": "D Minor",
        "timeSignature": "4",
    }


def test_manifest_is_extracted_from_the_pi_public_response() -> None:
    payload = {
        "spoken": "The lyrics are ready for review.",
        "presentation": {
            "kind": "status",
            "title": "Lyrics ready",
            "nodes": [{"id": "lyrics", "label": "Review lyrics"}],
            "edges": [],
            "songManifest": manifest(),
        },
    }
    parsed = manifest_from_pi_result(
        {"response": {"text": json.dumps(payload), "presentation": payload["presentation"]}}
    )

    assert parsed.title == "Signals After Midnight"
    assert parsed.duration_seconds == 120
    assert parsed.key_scale == "D Minor"


def test_manifest_accepts_bounded_lyric_lines() -> None:
    candidate = manifest()
    candidate.pop("lyrics")
    candidate["lyricLines"] = [
        "[Verse 1]",
        "Follow the signal home",
        "[Chorus]",
        "Stay",
    ]

    parsed = validate_song_manifest(candidate)

    assert parsed.lyrics == "[Verse 1]\nFollow the signal home\n[Chorus]\nStay"


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("lyrics", "No sections", "section markers"),
        ("durationSeconds", 301, "duration"),
        ("bpm", 20, "BPM"),
        ("keyScale", "some key", "key scale"),
        ("timeSignature", "5", "time signature"),
    ],
)
def test_manifest_rejects_values_outside_the_renderer_contract(
    field: str, value: object, message: str
) -> None:
    candidate = manifest()
    candidate[field] = value

    with pytest.raises(ValueError, match=message):
        validate_song_manifest(candidate)


def test_lyric_prompt_requires_grounding_review_and_no_private_material() -> None:
    prompt = lyric_prompt(
        brief="Turn the current pull request into a song.",
        style="R&B",
        duration_seconds=120,
    )

    assert "grounded only" in prompt
    assert "Do not include secrets" in prompt
    assert '"songManifest"' in prompt
    assert "ready for review" in prompt
