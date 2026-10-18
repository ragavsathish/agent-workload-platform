from voice_agent.tasking.domain.song_lifecycle import (
    SongTaskSnapshot,
    decide_render,
    parse_song_task,
    pending_song_task,
    project_song,
)


def completed_lyrics() -> SongTaskSnapshot:
    return (
        "completed",
        {
            "manifest": {
                "title": "Midnight Redirect",
                "style": "R&B",
                "lyrics": "[Verse 1]\nFollow the trace\n[Chorus]\nBring it home",
                "duration_seconds": 120,
                "bpm": 84,
                "key_scale": "D Minor",
                "time_signature": "4",
            }
        },
    )


def test_reviewed_lyrics_are_the_only_state_ready_to_render() -> None:
    ready = decide_render(
        cancelled=False,
        render_requested=False,
        lyrics=completed_lyrics(),
    )
    pending = decide_render(
        cancelled=False,
        render_requested=False,
        lyrics=pending_song_task(),
    )

    assert ready[0] == "ready"
    assert ready[1] is not None
    assert pending[0] == "not_ready"


def test_render_decision_table_keeps_safety_precedence_visible() -> None:
    cancelled = decide_render(
        cancelled=True,
        render_requested=True,
        lyrics=completed_lyrics(),
    )
    invalid = decide_render(
        cancelled=False,
        render_requested=False,
        lyrics=("completed", {"manifest": {"title": "incomplete"}}),
    )

    assert cancelled == ("cancelled", None)
    assert invalid == ("invalid_lyrics", None)


def test_complete_render_requires_an_immutable_audio_artifact() -> None:
    missing = project_song(
        cancelled=False,
        lyrics=completed_lyrics(),
        render=("completed", {"artifacts": {}}),
    )
    complete = project_song(
        cancelled=False,
        lyrics=completed_lyrics(),
        render=(
            "completed",
            {"artifacts": {"audio": "s3://agent-artifacts/songs/id/hash.m4a"}},
        ),
    )

    assert missing[0] == "failed"
    assert complete[0] == "complete"


def test_failed_projection_never_copies_internal_failure_details() -> None:
    snapshot = parse_song_task({
        "state": "failed",
        "failure": {
            "message": "private model output",
            "traceback": "/private/host/path and internal frames",
        },
    })

    view = project_song(cancelled=False, lyrics=snapshot, render=None)

    assert view[3] == "lyric generation failed"
    assert "private" not in view[3]


def test_cancelled_projection_does_not_publish_a_completed_audio_artifact() -> None:
    view = project_song(
        cancelled=True,
        lyrics=completed_lyrics(),
        render=(
            "completed",
            {"artifacts": {"audio": "s3://agent-artifacts/songs/id/hash.m4a"}},
        ),
    )

    assert view[0] == "cancelled"
    assert view[2] is None
