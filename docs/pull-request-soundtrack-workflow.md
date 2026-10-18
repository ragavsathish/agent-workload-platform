# Pull request soundtrack workflow

Use this workflow when a large or memorable change benefits from a pull request
description that is both an engineering summary and a generated song. The song
is optional; the pull request must remain understandable without playing it.

## Prerequisites

- Git and the authenticated GitHub CLI (`gh`)
- `ffmpeg` and `ffprobe`
- A local music-generation tool when a sung version is wanted. This repository
  used [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) with its MLX
  backend on Apple Silicon.

Do not commit model weights, generation caches, raw prompts containing private
data, or large uncompressed WAV files.

## 1. Prepare the branch

Review all changes, split them into coherent commits, and run the checks that
match each changed boundary.

```bash
git status --short
git diff --stat
git switch -c <branch-name>

# Repeat for each coherent change group.
git add <paths>
git commit -m "<scope>: <outcome>"

git push -u origin <branch-name>
```

Do not combine unrelated application, infrastructure, documentation, and media
changes merely to reduce the number of commits.

## 2. Create the engineering pull request

Write the initial body in a temporary Markdown file. Include the outcome,
important architecture or security decisions, and verified checks. Create the
pull request with `--body-file` so shell quoting cannot damage the Markdown.

```bash
gh pr create \
  --base main \
  --head <branch-name> \
  --title "<clear engineering title>" \
  --body-file /tmp/pr-body.md
```

At this point the pull request is complete enough to review. The soundtrack is
an additional presentation layer, not a substitute for the technical summary.

## 3. Turn the change into lyrics

Ground every line in the actual diff and architecture. A useful short form is:

1. Verse 1: request path and runtime changes.
2. Pre-chorus: the user-facing transition or handoff.
3. Chorus: the central outcome, phrased memorably.
4. Verse 2: learning, data, UI, or operational changes.
5. Bridge: isolation, security, and observability boundaries.
6. Repeated chorus and outro: restate the outcome and branch theme.

Spell initialisms phonetically in the generation lyrics when necessary (for
example, `M C P`, `D V C`, and `O Tel`). Keep the normal spelling in the PR text.
Never place credentials, private transcript text, identities, or production
payloads in lyrics.

## 4. Generate and validate the song

For **Signals After Midnight**, ACE-Step 1.5 generated a two-minute R&B track
locally with the following shape:

- 120 seconds, 82 BPM, D minor, 4/4
- warm lead vocal, backing harmonies, Rhodes, bass, relaxed drums, and guitar
- verse, pre-chorus, chorus, verse, bridge, repeated chorus, and outro
- WAV generation followed by AAC/M4A delivery

Run ACE-Step outside the repository or in an ignored build directory. Its API
accepts the style prompt, sectioned lyrics, duration, tempo, key, and output
format. Preserve only the final delivery artifact.

Convert the generated WAV to a compact format GitHub and browsers can deliver:

```bash
ffmpeg -i song.wav \
  -c:a aac -b:a 256k -movflags +faststart \
  song.m4a

ffprobe -v error \
  -show_entries format=duration,size \
  -show_entries stream=codec_name,sample_rate,channels \
  -of json song.m4a
```

Listen to the complete result before publishing it. Confirm that it contains no
unintended private material and that its duration, sample rate, and channels are
as expected.

## 5. Publish the audio

Store the compact artifact with the relevant product documentation. For this
repository:

```bash
cp song.m4a \
  products/voice-agent/docs/assets/<album-slug>.m4a
git add products/voice-agent/docs/assets/<album-slug>.m4a
git commit -m "docs: add <album-name> audio"
git push
```

Keep the media commit separate so reviewers can identify the binary addition.
GitHub's normal file limit still applies; use external artifact storage instead
of Git for large media.

After pushing, link to the audio by commit SHA rather than only by branch name.
The commit-pinned URL remains valid if the branch is deleted:

```text
https://raw.githubusercontent.com/<owner>/<repository>/<commit-sha>/<path>.m4a
```

## 6. Update and verify the pull request

Add the audio link and complete lyric sheet to the existing technical body, then
choose a concise album-style title based on the change's emotional and technical
theme.

```bash
gh pr edit <number> --title "<album-style title>"
gh pr edit <number> --body-file /tmp/pr-body-with-song.md
gh pr view <number> --json title,url,body
```

For the example PR, remote voice sessions, signals, tracing, and the R&B mood
became **Signals After Midnight**. The final verification is:

```bash
git status --short
gh pr view <number> --web
```

Check that the title is correct, the full lyrics render cleanly, the audio link
opens, the engineering test summary remains present, and the worktree is clean.
