"""Product integrations against the C2 Pi Durable owner protocol fixture."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from urllib.request import Request, urlopen

import allure
import pytest
from voice_agent.tasking.application.service import TaskService
from voice_agent.tasking.application.song_service import (
    SongGenerationError,
    SongService,
)
from voice_agent.tasking.infrastructure.config import Settings
from voice_agent.tasking.infrastructure.pi_durable_owner import PiDurableOwner

ROOT = Path(__file__).resolve().parents[4]
MOCK = ROOT / "apps/client/tool/container_mock/pi_durable_owner_server.clj"


def settings(tmp_path: Path, owner_url: str, token_file: Path) -> Settings:
    return Settings(
        allowed_users=("owner@example.com",),
        workspace_roots=(tmp_path,),
        pi_model=None,
        pi_thinking="medium",
        pi_session_dir=tmp_path / "sessions",
        pi_execution_mode="gondolin",
        max_output_bytes=1024,
        skills_dir=None,
        pi_durable_owner_url=owner_url,
        pi_durable_owner_token_file=token_file,
    )


def start_owner(tmp_path: Path):
    process = subprocess.Popen(
        ["bb", "-cp", "tool", str(MOCK)],
        cwd=ROOT / "apps/client",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    port = int(process.stdout.readline().strip())
    token_file = tmp_path / "owner-token"
    token_file.write_text("c2-pi-owner-token-000000000000000000000", encoding="utf-8")
    return process, f"http://127.0.0.1:{port}", token_file


def select_scenario(owner_url: str, scenario: str) -> None:
    request = Request(
        f"{owner_url}/__fixture/pi-owner/scenario",
        data=json.dumps({"scenario": scenario}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        assert response.status == 200


@allure.epic("Durable work")
@allure.feature("Journal and assertion classification")
@allure.story("Submit an owner turn as independent Pi Durable tasks")
def test_journal_and_classification_are_independent_native_tasks(tmp_path: Path) -> None:
    process, owner_url, token_file = start_owner(tmp_path)
    try:
        owner = PiDurableOwner(owner_url, token_file)
        service = TaskService(settings(tmp_path, owner_url, token_file))
        with allure.step("Given a completed owner turn is ready for durable learning"):
            transcript = "I learned that durable task IDs make retries safe."
            assert transcript
        with allure.step("When the Gateway sends it directly to Pi Durable"):
            result = service.enqueue_digital_twin(
                identity="owner@example.com",
                session_id="session-journal-1",
                message_id="owner-turn-7",
                transcript=transcript,
                captured_at="2026-10-27T10:00:00Z",
            )
            repeated = service.enqueue_digital_twin(
                identity="owner@example.com",
                session_id="session-journal-1",
                message_id="owner-turn-7",
                transcript=transcript,
                captured_at="2026-10-27T10:00:00Z",
            )
        with allure.step("Then journal extraction and assertion classification have separate durable task records"):
            tasks = result["tasks"]
            journal_id = tasks["journal"]["task_id"]
            classify_id = tasks["classify"]["task_id"]
            assert repeated["tasks"] == tasks
            assert journal_id != classify_id
            journal = owner.describe_product(journal_id)
            classify = owner.describe_product(classify_id)
            assert journal is not None and journal["kind"] == "digital-twin-journal"
            assert classify is not None and classify["kind"] == "digital-twin-classify"
            assert journal["params"]["transcript"] == transcript
            assert classify["params"]["transcript"] == transcript
            assert owner.get(journal_id)["state"] == "completed"
            assert owner.get(classify_id)["state"] == "completed"
            allure.attach(
                json.dumps({"tasks": tasks, "journal": journal, "classification": classify}, indent=2),
                "journal-classification-pi-durable-evidence",
                allure.attachment_type.JSON,
            )
    finally:
        process.terminate()
        process.wait(timeout=5)


@allure.epic("Durable work")
@allure.feature("Journal and assertion classification")
@allure.story("Keep owner-visible failures in native Pi Durable results")
def test_product_failures_remain_queryable_in_pi_durable(tmp_path: Path) -> None:
    process, owner_url, token_file = start_owner(tmp_path)
    try:
        select_scenario(owner_url, "task-failure")
        owner = PiDurableOwner(owner_url, token_file)
        service = TaskService(settings(tmp_path, owner_url, token_file))
        with allure.step("Given the Pi Durable owner is accepting tasks with a worker failure outcome"):
            pass
        with allure.step("When one completed owner turn fans out to journal and classification"):
            submitted = service.enqueue_digital_twin(
                identity="owner@example.com",
                session_id="session-failing-1",
                message_id="owner-turn-9",
                transcript="I prefer evidence-backed decisions.",
                captured_at="2026-10-27T11:00:00Z",
            )
        with allure.step("Then both independently queryable Pi Durable tasks retain their failure"):
            failures = {
                mode: owner.get(item["task_id"])
                for mode, item in submitted["tasks"].items()
            }
            assert set(failures) == {"journal", "classify"}
            assert all(item["state"] == "failed" for item in failures.values())
            assert all(item["failure"] == "mock task failed" for item in failures.values())
            allure.attach(json.dumps(failures, indent=2), "failed-learning-task-results", allure.attachment_type.JSON)
    finally:
        process.terminate()
        process.wait(timeout=5)


@allure.epic("Durable work")
@allure.feature("Song task lifecycle")
@allure.story("Create lyrics and request rendering as native Pi Durable tasks")
def test_song_lyrics_and_render_use_native_pi_durable_tasks(tmp_path: Path) -> None:
    process, owner_url, token_file = start_owner(tmp_path)
    try:
        service = SongService(settings(tmp_path, owner_url, token_file))
        owner = PiDurableOwner(owner_url, token_file)
        with allure.step("Given an authenticated owner asks for a song in an allowed workspace"):
            workspace = tmp_path / "workspace"
            workspace.mkdir()
        with allure.step("When lyrics are created and the owner requests rendering"):
            created = service.create(
                identity="owner@example.com",
                brief="A song about learning from durable tasks",
                workspace=str(workspace),
                style="Acoustic",
                duration_seconds=90,
            )
            assert created["status"] == "lyrics_ready"
            rendered = service.render(identity="owner@example.com", generation_id=created["id"])
        with allure.step("Then lyric and render work are separate native Pi Durable tasks with a reviewable manifest"):
            lyric = owner.describe_product(created["lyrics_task_id"])
            render = owner.describe_product(rendered["render_task_id"])
            assert lyric is not None and lyric["kind"] == "song-lyrics"
            assert render is not None and render["kind"] == "song-render"
            assert rendered["status"] == "complete"
            assert rendered["manifest"]["title"] == "Mock song"
            assert rendered["audio_artifact"] == "s3://agent-artifacts/mock.wav"
            allure.attach(
                json.dumps({"song": rendered, "lyric_task": lyric, "render_task": render}, indent=2),
                "song-pi-durable-evidence",
                allure.attachment_type.JSON,
            )
    finally:
        process.terminate()
        process.wait(timeout=5)


@allure.epic("Durable work")
@allure.feature("Song task lifecycle")
@allure.story("Keep failed lyric work visible and block rendering")
def test_failed_song_lyrics_remain_in_pi_durable_and_cannot_render(tmp_path: Path) -> None:
    process, owner_url, token_file = start_owner(tmp_path)
    try:
        select_scenario(owner_url, "task-failure")
        service = SongService(settings(tmp_path, owner_url, token_file))
        owner = PiDurableOwner(owner_url, token_file)
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        with allure.step("Given the Pi Durable worker fails while writing lyrics"):
            created = service.create(
                identity="owner@example.com",
                brief="A song about reliable retries",
                workspace=str(workspace),
                style="Acoustic",
                duration_seconds=90,
            )
        with allure.step("When the owner reads the generation and requests rendering"):
            result = owner.get(created["lyrics_task_id"])
            with pytest.raises(SongGenerationError, match="lyrics are not ready"):
                service.render(identity="owner@example.com", generation_id=created["id"])
        with allure.step("Then Pi Durable retains the lyric failure and no render task is created"):
            assert created["status"] == "failed"
            assert result["state"] == "failed"
            assert owner.describe_product(created["lyrics_task_id"])["kind"] == "song-lyrics"
            assert owner.describe_product(SongService.render_task_id(created["id"])) is None
            allure.attach(json.dumps({"song": created, "lyrics_result": result}, indent=2),
                          "failed-song-lyrics-evidence", allure.attachment_type.JSON)
    finally:
        process.terminate()
        process.wait(timeout=5)
