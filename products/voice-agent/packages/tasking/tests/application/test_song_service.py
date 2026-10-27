from dataclasses import replace
from pathlib import Path

import allure
import pytest
from voice_agent.tasking.application.song_service import SongGenerationError, SongService
from voice_agent.tasking.infrastructure.config import Settings


def settings(tmp_path: Path) -> Settings:
    return Settings(
        allowed_users=("owner@example.com",),
        workspace_roots=(tmp_path,),
        pi_model=None,
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        pi_execution_mode="gondolin",
        max_output_bytes=1024,
        skills_dir=None,
    )


@allure.epic("Durable work")
@allure.feature("Song task lifecycle")
@allure.story("Keep song lifecycle metadata in Pi Durable")
def test_song_metadata_render_request_and_cancellation_live_in_pi_durable(
    tmp_path: Path, monkeypatch
) -> None:
    service = SongService(settings(tmp_path))

    class Owner:
        def __init__(self):
            self.products = {}
            self.snapshots = {}
            self.submissions = []
            self.aborts = []

        def submit(self, kind, params, request_id):
            self.submissions.append((kind, params, request_id))
            self.products[request_id] = {
                "task_id": request_id,
                "kind": kind,
                "params": params,
                "created_at": "2026-10-26T12:00:00+00:00",
                "cancelled_at": None,
            }
            self.snapshots.setdefault(request_id, {"state": "pending", "result": None})
            return request_id

        def describe_product(self, task_id):
            return self.products.get(task_id)

        def get(self, task_id):
            return self.snapshots.get(task_id)

        def cancel_product(self, task_id, identity):
            assert self.products[task_id]["params"]["identity"] == identity
            self.products[task_id]["cancelled_at"] = "2026-10-26T12:01:00+00:00"

        def abort(self, task_id):
            self.aborts.append(task_id)

    owner = Owner()
    monkeypatch.setattr(service, "owner", owner)
    with allure.step("Given a song request is stored with its native Pi Durable lyric task"):
        created = service.create(
            identity="owner@example.com",
            brief="A song about the release",
            workspace=str(tmp_path),
            style="Warm R&B",
            duration_seconds=120,
        )
        assert created["status"] == "writing_lyrics"
        assert owner.products[created["lyrics_task_id"]]["params"]["brief"] == "A song about the release"
        with pytest.raises(SongGenerationError, match="not found"):
            service.get(identity="other@example.com", generation_id=created["id"])

    manifest = {
        "title": "Release Night",
        "style": "Warm R&B",
        "lyrics": "[Verse 1]\nWe ship tonight",
        "duration_seconds": 120,
        "bpm": 92,
        "key_scale": "D Minor",
    }
    owner.snapshots[created["lyrics_task_id"]] = {
        "state": "completed",
        "result": {"manifest": manifest},
    }
    with allure.step("When reviewed lyrics are ready, rendering creates one native task"):
        lyrics_ready = service.get(identity="owner@example.com", generation_id=created["id"])
        assert lyrics_ready["status"] == "lyrics_ready"
        rendered = service.render(identity="owner@example.com", generation_id=created["id"])
        assert rendered["status"] == "generating_music"
        assert rendered["manifest"]["title"] == "Release Night"
        again = service.render(identity="owner@example.com", generation_id=created["id"])
        assert again["render_task_id"] == rendered["render_task_id"]
        assert len([item for item in owner.submissions if item[0] == "song-render"]) == 1

    with allure.step("Then cancellation is retained in the owner document and aborts the active task"):
        cancelled = service.cancel(identity="owner@example.com", generation_id=created["id"])
        assert cancelled["status"] == "cancelled"
        assert owner.products[created["lyrics_task_id"]]["cancelled_at"] is not None
        assert owner.aborts == [rendered["render_task_id"]]
