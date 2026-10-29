---
type: howto
title: "Pull request soundtrack workflow"
---

# Pull request soundtrack workflow

Use this workflow for an AWP self-evolution pull request: its reviewed diff
grounds the lyrics, and its pull request body includes both the complete lyrics
and a reviewer-accessible song link alongside the engineering summary. For other
changes, the soundtrack remains optional. Every pull request must remain
understandable without playing the song.

## Prerequisites and boundaries

- Git and an authenticated GitHub CLI (`gh`) for the pull request.
- A running Voice Agent edge, gateway, durable worker, and S3Mock artifact store.
- The worker's configured ACE-Step API on host loopback. Before requesting a
  render, confirm its `/health` endpoint reports both models initialized. A
  successful proxy or a completed lyric task does not prove that music rendering
  is available.
- `ffprobe` for checking the delivered M4A. The worker, not the caller, uses
  FFmpeg to convert ACE-Step's WAV output to AAC/M4A.

The owner-facing song API is `/api/music/generations` on the authenticated Voice
Agent origin. The examples below use the host's **loopback-only** ingress at
`http://127.0.0.1:8080`; a remote caller must use the authenticated tailnet
origin. Do not submit work directly to ACE-Step or access S3Mock from a browser
or Pi tool. Pi Voice can use `submit_song`, `get_song`, `render_song`, and
`cancel_song` instead of the HTTP examples.

| Action | Pi Voice tool | Owner-facing HTTP endpoint |
|---|---|---|
| Start lyric work | `submit_song` | `POST /api/music/generations` |
| Review status and manifest | `get_song` | `GET /api/music/generations/{id}` |
| Start approved render | `render_song` | `POST /api/music/generations/{id}/render` |
| Cancel | `cancel_song` | `POST /api/music/generations/{id}/cancel` |
| Play completed artifact | returned `audio_path` | `GET /api/music/generations/{id}/audio` |

Do not put credentials, private transcripts, identities, unreviewed personal
information, or production payloads in the lyric brief, song, or pull request.
Do not commit model weights, generation caches, or raw WAV files.

## 1. Prepare the engineering pull request

Review the diff, split unrelated changes into coherent commits, and run checks
for the boundaries changed. Stage explicit paths when the worktree also has
other work in progress.

```bash
git status --short
git diff --stat
git add path/to/reviewed/file
git commit -m "<scope>: <outcome>"
git push -u origin HEAD
```

Write an initial pull request body with the outcome, architecture or security
decisions, and verified checks. Create it with `gh pr create --body-file` so the
technical summary exists before any optional music is generated. Do not use the
song as a substitute for the engineering description.

## 2. Submit a grounded lyric brief

Ground the brief in the actual diff and C4 architecture. Lead with the human
outcome, not a service inventory: the chorus should say why the work matters;
verses can carry selected request-path, durability, security, learning, and
observability details. Spell initialisms phonetically in lyrics when needed,
while keeping normal spelling in the technical pull request text.

```bash
song_api=http://127.0.0.1:8080/api/music/generations
curl -fsS -X POST "$song_api" \
  -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8080' \
  --data '{
    "brief": "Write a song about the reviewed change and its developer benefit...",
    "style": "Warm R&B, lead vocal, piano, bass, restrained drums...",
    "durationSeconds": 160
  }' | jq '{id,status,lyrics_task_id}'
```

`workspace` is optional and defaults to the configured Voice Agent workspace;
an explicit workspace must be on the gateway's allowlist. Save the returned
generation ID. Submission starts a durable `song-lyrics` Pi task and normally
returns `writing_lyrics`, not audio.

## 3. Review the lyric manifest before rendering

Query the generation until it reaches `lyrics_ready`:

```bash
song_id=PASTE_GENERATION_ID
curl -fsS "$song_api/$song_id" |
  jq '{status,manifest,failure}'
```

Show the owner the **complete** title, style, and lyrics. Render only after the
owner explicitly approves that manifest in a later turn. If a lyric or factual
claim changes, review the changed version again. A style-only alternate take
uses a new generation: ask Pi to preserve the approved lyric lines, then compare
the new `manifest.lyrics` to the approved text before rendering.

The public states are `writing_lyrics`, `lyrics_ready`, `generating_music`,
`complete`, `failed`, and `cancelled`. `failure` is a bounded public explanation;
do not treat a pending or failed generation as a playable song.

## 4. Render through the durable API

Check the configured host music service before crossing the review gate:

```bash
curl -fsS http://127.0.0.1:8001/health |
  jq -e '.data.models_initialized and .data.llm_initialized'
```

After explicit approval, submit one render command. It returns a durable render
task ID and normally projects `generating_music`:

```bash
curl -fsS -X POST "$song_api/$song_id/render" \
  -H 'Origin: http://127.0.0.1:8080' |
  jq '{status,render_task_id,failure}'
```

The worker sends the reviewed manifest to ACE-Step on loopback, waits for its
audio, converts it to AAC/M4A, and stores the bounded artifact in S3Mock. Query
the generation until `complete` and `audio_path` are present; the owner-checked
edge serves that path as `audio/mp4`. Never expose the ACE-Step file path or a
direct S3Mock URL.

```bash
curl -fsS "$song_api/$song_id" |
  jq '{status,audio_path,failure}'
curl -fsS -o song.m4a "$song_api/$song_id/audio"
ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,sample_rate,channels \
  -of json song.m4a
```

Listen to the complete result before publishing it. Confirm the vocal and
instrumental result is audible, the words are appropriate, and the duration and
format are plausible. If rendering fails, fix the service first. A generation
has one render request and the worker uses one durable attempt; retrying its
`/render` endpoint does not restart the failed job. Start a new generation,
preserve and recheck the approved lyrics, then explicitly approve its render.
Use `POST /api/music/generations/<id>/cancel` to cancel work that should stop.

## 5. Publish a compact artifact and relative README links

The API's `audio_path` is a private, tailnet-authenticated listening link. It
is not a permanent public pull request asset. For a repository soundtrack,
copy only the reviewed compact M4A into product documentation and commit it:

```bash
song_slug=let-me-hear-the-work
cp song.m4a "products/voice-agent/docs/assets/$song_slug.m4a"
git add "products/voice-agent/docs/assets/$song_slug.m4a"
git commit -m "docs: add reviewed soundtrack"
git push
```

Keep media separate from unrelated application or infrastructure changes. If
the same song has multiple arrangements, use distinct filenames and say that
the lyrics are shared. For example, this guide links to the committed
[R&B take](../../products/voice-agent/docs/assets/let-me-hear-the-work.m4a).
Use repository-relative links in both READMEs:

In the repository root README use `products/voice-agent/docs/assets/<song-slug>.m4a`;
in `products/voice-agent/README.md` use `docs/assets/<song-slug>.m4a`.
For a pull request body, use an access-checked,
commit-pinned GitHub artifact link rather than a private tailnet URL or a
branch-only URL. Large media belongs in artifact storage, not Git.

## 6. Update and verify the pull request

Add the complete lyrics, a link to each published arrangement, and a short note
about how the song relates to the engineering change. Keep the original test
summary and architecture decisions. An album-style title is optional.

```bash
gh pr edit --body-file /tmp/pr-body-with-song.md
gh pr view --json title,url,body
```

Check that the links play for the intended reviewers, the lyrics match the
approved manifest, and no private payload or unrelated worktree change entered
the commit. The song generation and playback API emits payload-free telemetry;
do not add lyrics or audio bytes to logs or traces.
