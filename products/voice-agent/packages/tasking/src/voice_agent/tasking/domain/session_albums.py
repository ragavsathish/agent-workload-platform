"""Stable, human-friendly names for durable task sessions."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass


@dataclass(frozen=True)
class SessionAlbum:
    key: str
    title: str
    artist: str
    spotify_url: str


SESSION_ALBUMS = (
    SessionAlbum(
        "kind-of-blue",
        "Kind of Blue",
        "Miles Davis",
        "https://open.spotify.com/album/1weenld61qoidwYuZ1GESA",
    ),
    SessionAlbum(
        "a-love-supreme",
        "A Love Supreme",
        "John Coltrane",
        "https://open.spotify.com/album/7Eoz7hJvaX1eFkbpQxC5PA",
    ),
    SessionAlbum(
        "time-out",
        "Time Out",
        "The Dave Brubeck Quartet",
        "https://open.spotify.com/album/0nTTEAhCZsbbeplyDMIFuA",
    ),
    SessionAlbum(
        "blue-train",
        "Blue Train",
        "John Coltrane",
        "https://open.spotify.com/album/2Z11cXWEa2qqYQBGkJrCga",
    ),
    SessionAlbum(
        "mingus-ah-um",
        "Mingus Ah Um",
        "Charles Mingus",
        "https://open.spotify.com/album/7pojWP7x9uEFSJgw765khA",
    ),
    SessionAlbum(
        "moanin",
        "Moanin'",
        "Art Blakey & The Jazz Messengers",
        "https://open.spotify.com/album/5PzlTnVafjgt5RtjTdIKoC",
    ),
    SessionAlbum(
        "maiden-voyage",
        "Maiden Voyage",
        "Herbie Hancock",
        "https://open.spotify.com/album/4PMwCdbTTBTgyMh8dbTVRb",
    ),
    SessionAlbum(
        "speak-no-evil",
        "Speak No Evil",
        "Wayne Shorter",
        "https://open.spotify.com/album/27Rl7A8jXEQOkIfUKOa6ZU",
    ),
    SessionAlbum(
        "saxophone-colossus",
        "Saxophone Colossus",
        "Sonny Rollins",
        "https://open.spotify.com/album/0yodD8uAkAT5UmrlF2xy97",
    ),
    SessionAlbum(
        "somethin-else",
        "Somethin' Else",
        "Cannonball Adderley",
        "https://open.spotify.com/album/3Wu0chxAm4GxSeRnIIf2Om",
    ),
    SessionAlbum(
        "in-a-silent-way",
        "In a Silent Way",
        "Miles Davis",
        "https://open.spotify.com/album/0Hs3BomCdwIWRhgT57x22T",
    ),
    SessionAlbum(
        "the-sidewinder",
        "The Sidewinder",
        "Lee Morgan",
        "https://open.spotify.com/album/1n1trPeeY9Q5H4eLbbHHRg",
    ),
    SessionAlbum(
        "song-for-my-father",
        "Song for My Father",
        "Horace Silver",
        "https://open.spotify.com/album/4LEnATSqKeANOJ0mLUAuCE",
    ),
    SessionAlbum(
        "head-hunters",
        "Head Hunters",
        "Herbie Hancock",
        "https://open.spotify.com/album/5fmIolILp5NAtNYiRPjhzA",
    ),
    SessionAlbum(
        "heavy-weather",
        "Heavy Weather",
        "Weather Report",
        "https://open.spotify.com/album/2M9F2yYsUvqiBPwUGeNvn1",
    ),
    SessionAlbum(
        "getz-gilberto",
        "Getz/Gilberto",
        "Stan Getz & Joao Gilberto",
        "https://open.spotify.com/album/3AXCsntzZYilqpvN1A7Tot",
    ),
    SessionAlbum(
        "ella-and-louis",
        "Ella and Louis",
        "Ella Fitzgerald & Louis Armstrong",
        "https://open.spotify.com/album/3kfnwa4p4uYiTOP8K8ooSE",
    ),
    SessionAlbum(
        "chet-baker-sings",
        "Chet Baker Sings",
        "Chet Baker",
        "https://open.spotify.com/album/5JJ779nrbHx0KB2lBrMMa4",
    ),
    SessionAlbum(
        "shape-of-jazz-to-come",
        "The Shape of Jazz to Come",
        "Ornette Coleman",
        "https://open.spotify.com/album/2iPH3iUmpa9ufIpwY76keF",
    ),
    SessionAlbum(
        "koln-concert",
        "The Köln Concert",
        "Keith Jarrett",
        "https://open.spotify.com/album/44VBsuqrEAyWidQU4CGNiu",
    ),
)

_BY_KEY = {album.key: album for album in SESSION_ALBUMS}


def album_for_session(session_id: str) -> SessionAlbum:
    """Choose an album deterministically without making session naming an LLM task."""

    digest = hashlib.md5(session_id.encode(), usedforsecurity=False).digest()
    return SESSION_ALBUMS[digest[0] % len(SESSION_ALBUMS)]


def least_used_album_for_session(
    session_id: str, usage_by_key: dict[str, int]
) -> SessionAlbum:
    """Pick fairly while retaining deterministic tie-breaking."""

    minimum = min(usage_by_key.get(album.key, 0) for album in SESSION_ALBUMS)
    start = SESSION_ALBUMS.index(album_for_session(session_id))
    for offset in range(len(SESSION_ALBUMS)):
        album = SESSION_ALBUMS[(start + offset) % len(SESSION_ALBUMS)]
        if usage_by_key.get(album.key, 0) == minimum:
            return album
    raise RuntimeError("session album catalog is empty")


def album_by_key(key: str) -> SessionAlbum:
    try:
        return _BY_KEY[key]
    except KeyError as exc:
        raise ValueError(f"unknown session album: {key}") from exc


def session_name_for_take(album: SessionAlbum, take: int) -> str:
    if take < 1:
        raise ValueError("session take must be positive")
    return album.title if take == 1 else f"{album.title} · Take {take}"
