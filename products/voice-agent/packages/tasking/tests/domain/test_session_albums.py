from voice_agent.tasking.domain.session_albums import (
    SESSION_ALBUMS,
    album_by_key,
    album_for_session,
    least_used_album_for_session,
    session_name_for_take,
)


def test_catalog_is_bounded_and_has_unique_stable_metadata() -> None:
    assert 20 <= len(SESSION_ALBUMS) <= 60
    assert len({album.key for album in SESSION_ALBUMS}) == len(SESSION_ALBUMS)
    assert len({album.title for album in SESSION_ALBUMS}) == len(SESSION_ALBUMS)
    assert len({album.spotify_url for album in SESSION_ALBUMS}) == len(SESSION_ALBUMS)
    assert all(
        album.spotify_url.startswith("https://open.spotify.com/album/")
        for album in SESSION_ALBUMS
    )


def test_session_assignment_is_deterministic_and_resolvable() -> None:
    first = album_for_session("7e635c29-8840-4aad-b840-f6d5a344ef68")
    second = album_for_session("7e635c29-8840-4aad-b840-f6d5a344ef68")

    assert first == second
    assert album_by_key(first.key) == first


def test_repeated_album_names_receive_a_human_friendly_take_number() -> None:
    album = album_by_key("koln-concert")

    assert session_name_for_take(album, 1) == "The Köln Concert"
    assert session_name_for_take(album, 3) == "The Köln Concert · Take 3"


def test_assignment_uses_every_album_before_repeating_one() -> None:
    usage = {album.key: 1 for album in SESSION_ALBUMS}
    usage["kind-of-blue"] = 0

    selected = least_used_album_for_session("new-task", usage)

    assert selected.key == "kind-of-blue"
