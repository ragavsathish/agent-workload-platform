from voice_agent.speech.application.transcription import extract_transcript


def test_extracts_valid_segments_without_exact_compression_ratio_rejection() -> None:
    result = extract_transcript(
        {
            "segments": [
                {
                    "text": "This is valid speech.",
                    "no_speech_prob": 0.1,
                    "compression_ratio": 0.5555555555555556,
                }
            ]
        }
    )

    assert result.text == "This is valid speech."
    assert result.outcome == "emitted"
    assert result.filtered_segments == 0


def test_reports_filtered_empty_without_exposing_text() -> None:
    result = extract_transcript(
        {"segments": [{"text": "noise", "no_speech_prob": 0.9}]}
    )

    assert result.text == ""
    assert result.outcome == "filtered_empty"
    assert result.filtered_segments == 1


def test_falls_back_to_top_level_text_when_segments_are_absent() -> None:
    result = extract_transcript({"text": "Fallback transcript."})

    assert result.text == "Fallback transcript."
    assert result.outcome == "emitted"
