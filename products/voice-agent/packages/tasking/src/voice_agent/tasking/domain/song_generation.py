"""Bounded manifest exchanged between the lyric Pi session and music renderer."""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from typing import Any

_KEY_SCALE = re.compile(r"^[A-G](?:#|b)? (?:Major|Minor)$")
_SECTION = re.compile(r"\[(?:Verse(?: [1-9][0-9]*)?|Pre-Chorus|Chorus|Bridge|Outro)\]", re.IGNORECASE)


@dataclass(frozen=True)
class SongManifest:
    title: str
    style: str
    lyrics: str
    duration_seconds: int
    bpm: int
    key_scale: str
    time_signature: str = "4"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def lyric_prompt(*, brief: str, style: str, duration_seconds: int) -> str:
    """Ask Pi for a reviewable manifest while retaining the normal public response."""
    return f"""
Write original song lyrics grounded only in this task context:

{brief.strip()}

Requested musical direction: {style.strip()}
Target duration: {duration_seconds} seconds.

Inspect the workspace when useful. Do not include secrets, credentials, private identity,
unreviewed personal information, or invented implementation claims. Use section markers such as
[Verse 1], [Pre-Chorus], [Chorus], [Bridge], and [Outro]. Make the chorus memorable and repeat it
in the lyric text where it should be sung.

Your final response must follow the required spoken/presentation response contract. Use a status
presentation and add one field named "songManifest" to that presentation with exactly these fields:
"title", "style", "lyricLines", "durationSeconds", "bpm", "keyScale", and "timeSignature".
"lyricLines" must be a JSON array with one section marker or lyric line per string; do not put raw
newlines or double quotation marks inside a line. Use an integer duration from 30 to 300, an integer
BPM from 40 to 200, a key such as "D Minor", and a time signature of "4". The spoken summary must
say that the lyrics are ready for review; do not claim that audio has been generated.
""".strip()


def _text(value: object, name: str, maximum: int) -> str:
    if not isinstance(value, str):
        raise TypeError(f"song manifest {name} must be text")
    cleaned = value.strip()
    if not cleaned or len(cleaned) > maximum:
        raise ValueError(f"song manifest {name} is outside its allowed size")
    return cleaned


def validate_song_manifest(value: object) -> SongManifest:
    if not isinstance(value, dict):
        raise TypeError("song manifest must be an object")
    title = _text(value.get("title"), "title", 200)
    style = _text(value.get("style"), "style", 1_000)
    lyrics_value = value.get("lyrics")
    lyric_lines = value.get("lyricLines", value.get("lyric_lines"))
    if lyrics_value is None and isinstance(lyric_lines, list):
        if not lyric_lines or len(lyric_lines) > 500 or not all(
            isinstance(line, str) and "\n" not in line and "\r" not in line
            for line in lyric_lines
        ):
            raise ValueError("song manifest lyric lines are invalid")
        lyrics_value = "\n".join(lyric_lines)
    lyrics = _text(lyrics_value, "lyrics", 20_000)
    if not _SECTION.search(lyrics):
        raise ValueError("song manifest lyrics require section markers")
    duration = value.get("durationSeconds", value.get("duration_seconds"))
    bpm = value.get("bpm")
    key_scale = _text(value.get("keyScale", value.get("key_scale")), "key scale", 32)
    time_signature = _text(
        value.get("timeSignature", value.get("time_signature", "4")),
        "time signature",
        8,
    )
    if not isinstance(duration, int) or isinstance(duration, bool) or not 30 <= duration <= 300:
        raise ValueError("song manifest duration must be an integer from 30 to 300")
    if not isinstance(bpm, int) or isinstance(bpm, bool) or not 40 <= bpm <= 200:
        raise ValueError("song manifest BPM must be an integer from 40 to 200")
    if not _KEY_SCALE.fullmatch(key_scale):
        raise ValueError("song manifest key scale is invalid")
    if time_signature not in {"3", "4", "6"}:
        raise ValueError("song manifest time signature is invalid")
    return SongManifest(
        title=title,
        style=style,
        lyrics=lyrics,
        duration_seconds=duration,
        bpm=bpm,
        key_scale=key_scale,
        time_signature=time_signature,
    )


def manifest_from_pi_result(result: object) -> SongManifest:
    """Read only the explicitly bounded manifest from a completed Pi task result."""
    if not isinstance(result, dict):
        raise TypeError("lyric task returned no result")
    direct = result.get("manifest")
    if direct is not None:
        return validate_song_manifest(direct)
    response = result.get("response")
    if not isinstance(response, dict):
        raise TypeError("lyric task returned no response")
    presentation = response.get("presentation")
    if isinstance(presentation, dict) and presentation.get("songManifest") is not None:
        return validate_song_manifest(presentation["songManifest"])
    text = response.get("text")
    if isinstance(text, str):
        try:
            payload: Any = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("lyric task response was not structured JSON") from exc
        if isinstance(payload, dict):
            candidate = payload.get("presentation")
            if isinstance(candidate, dict):
                return validate_song_manifest(candidate.get("songManifest"))
    raise ValueError("lyric task response did not contain a song manifest")
