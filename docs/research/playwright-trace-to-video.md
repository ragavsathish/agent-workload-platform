---
type: reference
title: "Rendering video from a Playwright trace"
---

# Rendering video from a Playwright trace

_Research date: 2026-10-17. Primary sources only. Repository baseline:
Playwright 1.58.2._

## Conclusion

Yes, a useful video can be reconstructed from a Playwright `trace.zip` **when
the trace was recorded with screenshots enabled**. The trace's film strip is a
timestamped screencast: each `screencast-frame` event points to a JPEG stored in
the archive. It is not normally a pre-encoded WebM or MP4. Playwright documents
that the `screenshots` tracing option records the screencast used by the film
strip, and its recorder source shows the frame event and JPEG write
([Trace Viewer: screenshots](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/docs/src/trace-viewer.md#screenshots),
[current recorder](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/trace/recorder/tracing.ts#L772-L791)).

Playwright has no supported trace-to-video export command. Its official trace
CLI exposes inspection, snapshots, screenshots, requests, and attachments but
not video export
([trace CLI](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/tools/trace/traceCli.ts#L33-L151)).
Conversion therefore means parsing a versioned internal trace format and
encoding its JPEG frames with a tool such as FFmpeg.

This is best treated as a **recovery/export feature**, not a replacement for
native Playwright video. For a future run where video is required, enable the
separate `video` option and retain the resulting `.webm`; Playwright writes that
artifact into the test output directory
([Playwright video documentation](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/docs/src/videos.md)).

## What is inside `trace.zip`

The archive is a container, not one media stream. A trace chunk contains a
JSON-lines `.trace` event file, a `.network` event file, and binary files
referenced by those events. Playwright's 1.58.2 archive builder names the first
two `trace.trace` and `trace.network` and places referenced blobs below
`resources/`
([1.58.2 archive assembly](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/trace/recorder/tracing.ts#L347-L398)).
Playwright Test can merge more than one trace stream into an archive and rename
colliding entries, so a general converter must enumerate every `*.trace`
member rather than assume that only `trace.trace` exists
([test trace merge](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/worker/testTracing.ts#L353-L406),
[official loader enumeration](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/traceLoader.ts#L30-L79)).

The relevant format differs by Playwright version:

| Format | Frame event | JPEG location |
|---|---|---|
| Repository's Playwright 1.58.2, trace v8 | `type`, `pageId`, `sha1`, `width`, `height`, `timestamp`, optional `frameSwapWallTime` | `resources/<sha1>` |
| Current upstream trace v10 | Same timing and page fields, but `file` replaces `sha1` | The referenced path, currently `screencast/<page>-<time>.jpeg` |

The v8 schema and recorder are explicit about the SHA-1 reference and the JPEG
resource
([v8 event schema](https://github.com/microsoft/playwright/blob/v1.58.2/packages/trace/src/trace.ts#L51-L59),
[v8 frame recording](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/trace/recorder/tracing.ts#L594-L614)).
The current schema uses a `file` reference and the current recorder writes it
under `screencast/`
([v10 event schema](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/versions/traceV10.ts#L104-L112),
[current frame recording](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/trace/recorder/tracing.ts#L772-L791)).
Playwright's own modernizer maps v3-v8 `sha1` values to
`resources/<sha1>`, confirming the compatibility rule
([trace modernizer](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/traceModernizer.ts#L500-L512)).

DOM snapshots are different data. With `snapshots` enabled, Playwright captures
complete DOM snapshots around actions for interactive inspection; they are not
the JPEG film-strip frames
([Trace Viewer: snapshots](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/docs/src/trace-viewer.md#snapshots)).
If an archive has no `screencast-frame` events, it cannot yield a faithful
time-based video. A tool could render selected DOM snapshots into a synthetic
slideshow, but that is a separate browser-rendering feature rather than frame
extraction.

Ordinary Playwright video remains separate from the trace screencast. A trace
can nevertheless contain arbitrary binary test attachments, including a video
explicitly attached by a test; current Playwright stores such attachment
content under `attachments/<sha1>`
([test attachment handling](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright/src/worker/testTracing.ts#L217-L238)).
Therefore a converter may first expose an already-attached video, but it should
not expect normal trace recording to have produced one.

## Conversion pipeline

The smallest robust offline pipeline is:

1. Validate the ZIP and enumerate all members. Parse every `*.trace` member as
   JSON Lines. Reject malformed events and unsafe archive paths.
2. Collect `screencast-frame` events. Resolve `file` directly for current
   traces and `resources/<sha1>` for v8 traces. Verify each referenced file is
   present and decodes as JPEG.
3. Partition frames by trace context and `pageId`, then order each page by
   timestamp. Produce one video per page by default; the format records page
   lanes but supplies no semantic rule for choosing between a main page and
   popups
   ([frame grouping in the modernizer](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/traceModernizer.ts#L86-L96),
   [page/frame association](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/traceModernizer.ts#L130-L132)).
4. Give each JPEG the duration until the next frame. This matches Trace
   Viewer's behavior: it selects the latest frame at or before the requested
   preview time, effectively holding it until another frame arrives
   ([film-strip selection](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/trace-viewer/src/ui/filmStrip.tsx#L185-L228)).
   To mirror Playwright's native 1.58.2 recorder, prefer
   `frameSwapWallTime` when every frame in the lane has it; otherwise use the
   monotonic `timestamp` consistently. The native recorder uses
   `frameSwapWallTime`, while the event schema makes that field optional
   ([native 1.58.2 recorder input](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/screencast.ts#L59-L76),
   [v8 event schema](https://github.com/microsoft/playwright/blob/v1.58.2/packages/trace/src/trace.ts#L51-L59)).
5. Write an FFconcat manifest with one `file` and `duration` pair per JPEG,
   repeat the final file entry so its duration is honored, and encode to WebM
   or MP4. FFmpeg defines the concat demuxer, its `duration` directive, and the
   requirement that input streams have compatible properties
   ([FFmpeg concat documentation](https://ffmpeg.org/ffmpeg-formats.html#concat-1)).
   Normalize all frames onto one even-sized canvas before encoding. Playwright's
   own recorder similarly pads/crops frames and emits constant-frame-rate video
   from timestamped JPEG input
   ([native recorder](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/videoRecorder.ts#L149-L165)).
6. Emit a small JSON sidecar containing source trace digest, Playwright/trace
   version, selected page, time range, frame count, skipped/corrupt frames, and
   encoder command. Fail clearly if there are no usable frames.

For archives with several trace contexts, timestamps may need alignment before
frames are combined. Playwright's model shifts monotonic times using the
relationship between `wallTime` and `monotonicTime`; a converter that joins
contexts should reproduce that logic or deliberately keep contexts separate
([clock alignment](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/traceModel.ts#L293-L365)).

## Quality and fidelity limits

Trace frames are deliberately sparse. In Playwright 1.58.2, tracing throttles
the screencast to about one frame every 200 ms after a ten-frame burst, while
temporarily recharging the burst around actions; the target image is at most
800 by 600 with JPEG quality 90
([1.58.2 throttler](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/screencast.ts#L32-L56),
[1.58.2 trace dimensions](https://github.com/microsoft/playwright/blob/v1.58.2/packages/playwright-core/src/server/trace/recorder/tracing.ts#L77-L77)).
Current upstream retains a 200 ms throttled interval and a 500 ms unthrottled
window around actions, scales the viewport to a maximum dimension of 800, and
uses JPEG quality 90
([current trace throttling](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/trace/recorder/tracing.ts#L879-L928),
[current screencast sizing](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/screencast.ts#L142-L164)).
The result will look like a variable-rate diagnostic replay—often around 5 fps
between actions—not a smooth screen recording. Encoding it at 25 or 30 fps only
duplicates held frames; it cannot recover motion that was never captured.

There is no audio track in the screenshot stream. Playwright's native video
encoder also passes `-an`, explicitly disabling audio
([native encoder arguments](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/playwright-core/src/server/videoRecorder.ts#L154-L165)).
Canvas, WebGL, rapid animation, cursor movement between captured frames, and
content on a non-selected page can therefore be missing or discontinuous.

The trace format is versioned internal data, not a stable media interchange
format: repository version 1.58.2 declares trace version 8, while current
upstream declares a different event shape in version 10
([1.58.2 version](https://github.com/microsoft/playwright/blob/v1.58.2/packages/trace/src/trace.ts#L23-L24),
[current v10 schema](https://github.com/microsoft/playwright/blob/b335271cdc2b57cac2be8ad37c5dd283ac6b8938/packages/isomorphic/trace/versions/traceV10.ts#L104-L121)).
The converter must detect the schema and fail on unsupported versions rather
than silently create a wrong video.

## Recommendation for this repository

The client already pins Playwright 1.58.2 and records screenshot-enabled traces
for Vitest browser tests
([client package](../../products/voice-agent/apps/client/package.json),
[Vitest trace configuration](../../products/voice-agent/apps/client/vitest.browser.config.mjs#L64-L70)).
Patrol also forces `screenshots: true`, and the existing inspector already
validates `trace.zip`, parses `trace.trace`/`trace.network`, and counts
`screencast-frame` events
([Patrol trace patch](../../products/voice-agent/apps/client/tool/patch-patrol-web-trace.clj),
[trace inspector](../../products/voice-agent/apps/client/tool/inspect-patrol-trace.clj)).
FFmpeg is already an operational dependency of the browser E2E playbook
([Playwright E2E playbook](../../products/voice-agent/automation/playbooks/playwright_e2e.yml#L49-L83)).

Add a sibling tool such as
`products/voice-agent/apps/client/tool/render-playwright-trace-video.mjs`
only when an actual consumer needs the export. Reuse the inspector's ZIP
validation and JSONL conventions, but scan all `*.trace` entries and support
both the pinned v8 `sha1` layout and current `file` layout. Default to one
timestamp-preserving video per page plus a provenance sidecar. Keep outputs
under the existing ignored `build/` artifact tree and do not make video
rendering part of the normal test pass/fail path.

For future tests where smooth playback matters, configure Playwright's native
`video` option instead of deriving video from trace. Retain both artifacts when
useful: the trace provides actions, DOM, console, and network diagnostics,
while the native WebM provides the better motion record. Trace-derived video
is most valuable when only a historical `trace.zip` remains or when a small,
portable visual summary is needed.

## Developer-oriented TTS narration

A narrated export is more useful than adding speech to the trace's original
clock. Trace actions often complete in milliseconds and the screenshot stream
is deliberately sparse, so ordinary narration cannot fit intelligibly into the
source duration. Build a separate **explainer timeline** instead:

1. Extract a sanitized evidence model from the trace: meaningful user actions,
   page transitions, assertion outcomes, failed requests, console errors, and
   the nearest frame before and after each event. Do not send the raw trace,
   headers, cookies, request bodies, DOM text, or unredacted console output to
   a hosted model.
2. Convert that evidence into short scenes. Hold the relevant frame while the
   narration explains (a) developer intent, (b) the observable change, and
   (c) the outcome or failure. Skip waits, polling, retries, and repeated
   framework actions unless they explain a timing problem.
3. Generate one audio clip per scene rather than one monolithic recording.
   Segment-level audio makes it possible to extend a still frame to the actual
   speech duration, insert a small pause, and rebuild only a changed scene.
4. Render the exact narration as captions and burn in a compact action/result
   label. Captions make the artifact searchable and accessible and remain the
   authoritative explanation if TTS generation is unavailable.
5. Concatenate the paced scenes and mux the narration into the final MP4. Keep
   the original timestamp-preserving silent replay as a separate artifact; it
   is evidence, while the narrated cut is an interpretation of that evidence.

This repository already has the preferred TTS implementation. The native
inference broker exposes an authenticated `POST /v1/audio/speech` endpoint,
loads the configured `mlx-community/Kokoro-82M-bf16` model once, serializes
local MLX inference, and returns mono signed 16-bit PCM at 24 kHz
([broker endpoint](../../products/voice-agent/apps/broker/src/voice_agent/speech/presentation/http.py#L132-L150),
[Kokoro adapter](../../products/voice-agent/apps/broker/src/voice_agent/speech/infrastructure/mlx_tts.py#L45-L87),
[deployment defaults](../../products/voice-agent/deploy/.env.example#L8-L14)).
It is deliberately bound to Mac loopback and protected by a bearer capability;
the renderer should accept the broker base URL and token through environment
variables and must not embed or copy the credential into an artifact.

Generate one scene at a time with a request shaped like the existing edge
client: model `kokoro`, a compatibility voice value, `response_format: "pcm"`,
and a bounded speed value. The current broker accepts at most 2,000 input characters,
supports only PCM, and uses the server-configured model and voice even though
the compatibility request contains `model` and `voice` fields
([request contract](../../products/voice-agent/apps/broker/src/voice_agent/speech/presentation/http.py#L39-L45),
[speech request](../../products/voice-agent/apps/broker/src/voice_agent/speech/presentation/http.py#L75-L80),
[existing edge caller](../../products/voice-agent/apps/edge/bot.py#L407-L432)).
Treat the returned bytes as `s16le`, 24,000 Hz, one channel; wrap them in WAV
or give FFmpeg those input parameters explicitly, then encode AAC when muxing a
broadly compatible H.264 MP4. Make calls sequentially because the broker shares
one inference slot across STT and TTS. Record the configured model, voice,
speed, scene-text digest, and audio digest in the provenance sidecar.

A hosted provider can remain an optional adapter, but it is not the default.
If OpenAI TTS is selected explicitly, the Speech API supports `gpt-4o-mini-tts`,
delivery instructions, and WAV output; the official guide currently recommends
`marin` or `cedar` for best quality
([OpenAI text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)).

Use a restrained instruction such as: _Speak clearly for a software developer,
at a measured pace. Be factual and concise. Briefly pause between the action,
observed result, and diagnosis. Do not dramatize._ The narration script should
prefer product language over raw selectors: “The test opens the task details”
is useful; “locator `div:nth-child(4)` was clicked” usually is not. Preserve a
selector only when it is itself the likely cause of failure.

The narrated output should satisfy these acceptance criteria:

- An opening sentence states the test name, browser, result, and that the voice
  is synthesized. When a hosted provider is used, also apply that provider's
  disclosure policy; OpenAI requires clear disclosure that its TTS voice is
  AI-generated
  ([OpenAI disclosure requirement](https://developers.openai.com/api/docs/guides/text-to-speech#text-to-speech)).
- Every spoken claim is traceable to a captured action, assertion, network
  event, console event, or frame. Inference is explicitly introduced as a
  possible explanation, not stated as fact.
- Successful journeys summarize only meaningful milestones. Failed journeys
  spend most of their time on the last successful state, the failing action,
  the visible symptom, and supporting console/network evidence.
- Speech never overlaps a scene change, is not time-compressed to fit the raw
  trace, and has matching captions.
- Secrets and personal data are redacted before script generation and again
  before TTS. The sidecar records the sanitized script digest, TTS model,
  voice, generation settings, and resulting audio digest.
- If the TTS service or API key is unavailable, rendering still succeeds with
  the silent replay, captions, and narration script. Narration is opt-in and is
  not part of the test pass/fail path.

For this repository, extend the proposed renderer as two explicit phases:
`render-playwright-trace-video.mjs` creates the evidence replay and a sanitized
scene manifest; a separate narration command consumes only that manifest,
calls the existing local broker, and produces the developer explainer. This
boundary keeps trace parsing deterministic and leaves hosted TTS as an explicit
interchangeable adapter rather than an implicit data flow. In the implemented
sandbox, the local Mac broker still performs Kokoro inference, but the render
container sends only bounded narration text and receives generated PCM; Recast
and FFmpeg never execute directly on the host.

## Reusing the Marp and Wassette architecture

Wassette and Marp are separate layers in this repository. Wassette is a
deferred MCP tool provider for capability-controlled WebAssembly components; it
runs with a scrubbed process environment and a dedicated capability file
([voice registration](../../products/voice-agent/apps/pi-agent/voice-agent/pi-session.ts#L13-L72)).
Marp is a browser-side MCP App that receives bounded structured presentation
data and renders slides. There is no installed Marp Wassette component in the
current component directory, and the video renderer should not become one:
trace ZIP access, FFmpeg, browser rendering, and output-file creation would
require broad host capabilities that do not fit Wassette's narrow integration
boundary.

The Marp **response contract** is directly reusable. Existing agent responses
already separate concise TTS-ready `spoken` text from a structured
`presentation`, route `kind: "slides"` to `ui://slides/marp.html`, and limit
both spoken text and slide Markdown
([task response contract](../../products/voice-agent/packages/tasking/src/voice_agent/tasking/application/pi_response.py#L9-L39),
[voice response normalization](../../products/voice-agent/apps/edge/presentation_response.py#L352-L428)).
Represent each narrated trace scene with the same conceptual fields:

```json
{
  "spoken": "The test submits the task and receives a successful response.",
  "presentation": {
    "kind": "slides",
    "title": "Submit task",
    "markdown": "# Submit task\n\n**Result:** HTTP 201"
  },
  "evidence": {
    "pageId": "page@…",
    "frame": "resources/page@…jpeg",
    "eventIds": ["call@…"]
  }
}
```

Keep `evidence` local to the renderer; do not send it to the MCP App or TTS
endpoint. The `spoken` field drives Kokoro and captions. The Marp slide supplies
developer context such as the action, observed result, latency, and failure
evidence. The referenced trace frame remains the primary visual evidence.

The existing Marp App is suitable for rendering the explanatory cards: it
disables raw HTML and scripts, removes external CSS imports, rejects Markdown
larger than 64 KiB, has no network connection capability in its CSP, bundles
KaTeX fonts, supports fenced Mermaid, and renders each slide as an SVG
([Marp renderer](../../products/voice-agent/apps/client/bridge/marp_app.js),
[sandbox template](../../products/voice-agent/apps/client/marp_app/index.html)).
It exposes manual previous/next navigation but no export API. An offline
renderer can load the built App in Playwright, inject the bounded presentation
through the existing MCP App bridge, select each active
`svg[data-marpit-svg]`, and capture it. Browser tests already exercise that
exact host/App path
([Marp browser test](../../products/voice-agent/apps/client/browser_test/mcp_app_renderers.browser.test.js#L6-L63)).

Do not embed all trace JPEGs as Marp data URLs. Although the CSP permits data
images, the 64 KiB Markdown limit makes that fragile and it would duplicate
evidence bytes. Instead, compose the video from two scene types:

- **Evidence scene:** the extracted trace JPEG, held for the narration duration,
  with a small action/result label and exact caption.
- **Explanation scene:** a Marp-rendered SVG for the opening summary, a complex
  sequence or Mermaid relationship, and the final diagnosis/recommendation.

This yields a developer-oriented walkthrough without replacing evidence with a
model-authored slide deck. Generate explanation slides only from the sanitized
scene manifest, keep each spoken claim linked to its evidence IDs, and preserve
the original timestamped replay alongside the narrated explainer.

## Prototype result

The first throwaway
[`prototype-trace-explainer.mjs`](../../products/voice-agent/apps/client/tool/prototype-trace-explainer.mjs)
validated the complete local path with direct FFmpeg scene assembly. The
production-oriented POC now pins `playwright-recast` 0.23.0 and delegates trace
frame reconstruction, narration-driven frame holds, audio synchronization,
subtitle embedding, and MP4 rendering to that library:

```text
trace.zip -> playwright-recast trace timeline -> repository SRT scenes
          -> local Kokoro TtsProvider -> held trace frames
          -> H.264/AAC MP4 + mov_text captions
```

The retained Gitea trace contained 10 primary-page frames and 33 recorded calls
over 1.35 seconds. Two evidence-bounded narration scenes produced a 22.37-second,
1280 by 720 MP4 with H.264 video, mono 24 kHz AAC narration, and an embedded
`mov_text` subtitle track. Recast reconstructed the sparse trace frames and
added 11.2 seconds of narration-driven holds rather than compressing speech.
The manifest records `playwright-recast` 0.23.0 as the renderer.

The prototype answers the feasibility question positively, but also exposes
the main product limitation: this Patrol trace runs much of the journey inside
one `evaluateExpression` call. Its Playwright event stream records viewport
changes and page lifecycle calls, not every semantic test step. Frames show the
UI state, but a deterministic converter cannot reliably name the developer's
intent from low-level calls alone. A production explainer therefore needs one
of these evidence sources, in priority order:

1. explicit `test.step` names or trace annotations emitted by the test;
2. sanitized structured attachments describing milestones and expectations;
3. a tightly grounded model summary of the sanitized scene manifest and
   selected frames, with every inference marked as such.

The validated seam is the scene manifest: one bounded `spoken` string, one
visual source, exact evidence IDs, and measured audio duration per scene. Keep
trace parsing, narration authoring, TTS, and video assembly as separate stages.
The production implementation should replace the prototype's trace-specific
scene selection and call IDs, add a dark Marp theme, and require semantic test
metadata before making claims about user intent.

## Open-source alternatives and an MCP App path

Research refreshed 2026-10-17. There is now a close open-source alternative to
the custom prototype: [`playwright-recast`](https://github.com/ThePatriczek/playwright-recast)
accepts either a standalone `trace.zip` or a test-results directory containing a
native Playwright video, reconstructs sparse trace frames when no WebM exists,
and already implements pacing, subtitles, narration-driven frame holds, zoom,
cursor/click overlays, multi-page composition, and MP4/WebM rendering. It also
ships an MCP **tool server** with `record_session`, `analyze_trace`,
`list_recordings`, and `render_video`; it is not an interactive MCP App UI. The
package and source are MIT-licensed
([README and MCP server](https://github.com/ThePatriczek/playwright-recast#MCP-Server),
[license](https://github.com/ThePatriczek/playwright-recast/blob/main/LICENSE)).

That experiment is now complete: the client pins `playwright-recast` 0.23.0,
the retained Playwright 1.58.2 Gitea trace renders successfully, and a small
repository adapter implements recast's `TtsProvider` contract using the
authenticated local Kokoro endpoint. We reuse the library API rather than its
separate MCP server because trace selection, opaque artifact IDs, owner-only
HTTP delivery, and the existing Trace Viewer MCP App remain repository-owned.
The sanitized narration and evidence manifest also remain repository-owned.
Playwright
documents Trace Viewer, not a public trace-to-video API, and the trace format
remains internal. For future captures, prefer Playwright's native video or its
public screencast API over reconstructing low-cadence trace JPEGs
([Trace Viewer](https://github.com/microsoft/playwright/blob/main/docs/src/trace-viewer.md),
[Screencast API](https://github.com/microsoft/playwright/blob/main/docs/src/api/class-screencast.md),
[Playwright license](https://github.com/microsoft/playwright/blob/main/LICENSE)).

### Component choices

| Layer | Candidate | License and deployment consequence | Recommendation |
|---|---|---|---|
| Direct trace pipeline | `playwright-recast` | MIT; Node plus system `ffmpeg`/`ffprobe`; closest functional match and already has an MCP server | Spike first; wrap or fork if its trace parser is reliable on retained fixtures |
| Media engine | FFmpeg | LGPL-2.1-or-later by default, but enabling GPL components makes the FFmpeg build GPL; the official checklist specifically calls out `libx264` | Keep invoking a system binary and record `ffmpeg -version`/configuration in provenance; audit any binary that is redistributed ([FFmpeg legal guidance](https://ffmpeg.org/legal.html)) |
| Python composition | MoviePy | MIT, but it still depends on FFmpeg and adds Python, NumPy, Pillow, and OpenCV to this Node-oriented path ([project and license](https://github.com/Zulko/moviepy)) | Useful for a Python-only prototype, not an improvement here |
| Declarative Node composition | Editly | MIT; provides image, audio, title, transition, and FFmpeg assembly, but no Playwright trace semantics ([project](https://github.com/mifi/editly)) | Consider only if recast's renderer cannot accept repository-owned scenes |
| Animated cards | Motion Canvas | MIT; capable TypeScript animation/rendering stack ([license](https://github.com/motion-canvas/motion-canvas/blob/main/LICENSE)) | Keep Marp until developer explanation needs animation rather than slides |
| React video composition | Remotion | Source-available under a custom license: free eligibility is limited, and other for-profit organizations require a company license ([license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)) | Do not describe it as an unrestricted open-source replacement; require a licensing decision before adoption |

The current TTS choice remains the strongest local option. MLX-Audio is MIT,
targets Apple Silicon, supports Kokoro, and exposes an OpenAI-compatible speech
endpoint; the deployed MLX Kokoro weights and upstream Kokoro model are
Apache-2.0
([MLX-Audio](https://github.com/Blaizzy/mlx-audio),
[MLX-Audio license](https://github.com/Blaizzy/mlx-audio/blob/main/LICENSE),
[MLX Kokoro model card](https://huggingface.co/mlx-community/Kokoro-82M-bf16),
[upstream Kokoro model card](https://huggingface.co/hexgrad/Kokoro-82M)).
Replacing it would increase risk without solving a current limitation.
Chatterbox Flash is an MIT-licensed Apple MLX/Metal option worth evaluating only
if expressive voice cloning becomes a requirement
([official repository](https://github.com/resemble-ai/chatterbox-flash)). The
maintained Piper successor is GPL-3.0 and voice licenses vary per model card, so
it is a poor default for a distributable product
([Piper repository](https://github.com/OHF-Voice/piper1-gpl),
[voice-license guidance](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md)).
Sherpa-ONNX's top-level code is Apache-2.0, but its Apple TTS dependency/license
inventory is currently under explicit review around GPL eSpeak NG; do not infer
the license of a bundled runtime from the top-level file alone
([Apple TTS license inventory](https://github.com/k2-fsa/sherpa-onnx/issues/4053)).

### Make the explainer a real MCP App

An MCP App has two distinct halves: a normal MCP server performs trusted work,
and a sandboxed HTML View renders the result. The server registers a
`ui://trace-explainer/main.html` resource with media type
`text/html;profile=mcp-app`, then binds a tool to that fixed URI through
`_meta.ui.resourceUri`. The official helpers are `registerAppResource` and
`registerAppTool`; the tool should declare both input and output schemas and
return a meaningful text fallback plus bounded `structuredContent`
([resource helper](https://apps.extensions.modelcontextprotocol.io/api/functions/server-helpers.registerAppResource.html),
[tool helper](https://apps.extensions.modelcontextprotocol.io/api/functions/server-helpers.registerAppTool.html),
[MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).

Use this server surface:

- `list_trace_recordings`, read-only and model-visible, returns opaque trace IDs
  from configured artifact roots. Never accept an arbitrary host path from a
  model or View.
- `render_trace_explainer`, model-visible, accepts a trace ID and bounded render
  options. The server validates/extracts the ZIP, creates the sanitized scene
  manifest, calls the local broker sequentially, runs FFmpeg without a shell,
  and returns the completed result for the first version.
- `get_trace_explainer`, optionally app-visible, returns status and the bounded
  manifest for a render ID. Add asynchronous jobs and polling only after the
  host proxies app-originated server tools.

The successful `render_trace_explainer` result should contain a short text
summary for non-App hosts, a schema-validated structure such as
`{renderId,status,title,durationMs,scenes,captionUri,videoUri}`, and a
`resource_link` to the MP4 rather than embedding video bytes. Large resources
should be fetched only when needed; the TypeScript MCP SDK documents
`resource_link` specifically for that purpose
([SDK server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md#resourcelink-outputs)).
The View should show status, evidence-linked scenes, the exact captions, and a
video preview when the host can resolve the media resource. FFmpeg, ZIP parsing,
TTS credentials, and raw trace data remain server-side.

The protocol lifecycle is deterministic:

1. The host discovers the tool and its fixed App URI, calls the tool, and reads
   the referenced resource with `resources/read`.
2. The View connects to the host over JSON-RPC 2.0 via `postMessage`, sends
   `ui/initialize`, receives negotiated host capabilities/context, then sends
   `ui/notifications/initialized`.
3. The host sends complete tool input at most once and before the tool result,
   then sends `ui/notifications/tool-result` (or cancellation). During later
   interaction, the View may call only tools whose visibility includes `app`
   and only when the host advertises server-tool proxying.
4. Before removal, the host sends `ui/resource-teardown`; the View releases
   media URLs/listeners and acknowledges before the iframe is destroyed.

These ordering and visibility rules are normative in the MCP Apps lifecycle
and tool metadata sections
([lifecycle](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#lifecycle),
[tool input/result notifications](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#notifications-host--view),
[tool visibility](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#tool-to-ui-resource-linkage)).

This repository already contains both useful precedents, but they are not yet
one end-to-end standard server flow. The vendored Excalidraw server uses the
official resource/tool helpers and supports stdio plus Streamable HTTP
([registration](../../vendor/excalidraw-mcp/src/server.ts#L401-L704),
[transports](../../vendor/excalidraw-mcp/src/main.ts)). The Voice client uses
the official `App`/`AppBridge` packages, a hardcoded resource allowlist, and an
opaque-origin `sandbox="allow-scripts"` iframe; it tears down the old View and
sends input before result
([host](../../products/voice-agent/apps/client/bridge/voice_bridge.js#L72-L379),
[Marp View](../../products/voice-agent/apps/client/bridge/marp_app.js)). That is
a sound least-privilege renderer, but today it loads locally mapped URLs rather
than discovering and reading arbitrary MCP App resources, and it does not
advertise a server-tools proxy. The smallest first integration is therefore a
completed-result View added to the existing allowlist. The interoperable next
step is to reuse the Excalidraw server pattern and teach the host to honor the
tool's static `_meta.ui.resourceUri`, `resources/read`, and capability-gated
app-only tool calls.

Security requirements are stricter than for Marp because traces and videos are
large and may contain credentials or personal data. Enforce compressed and
expanded byte limits, member-count and compression-ratio limits, normalized ZIP
paths, supported trace versions, image decoding limits, render time/CPU/disk
quotas, per-caller artifact namespaces, opaque IDs, expiry, and cleanup. Never
render trace HTML/DOM snapshots as active HTML. Apply redaction before both
narration and View data. Keep the App CSP at `default-src 'none'`; declare only
the exact media/connect origin if preview requires it, request no camera,
microphone, geolocation, or clipboard permission, and do not grant
`allow-same-origin`. MCP Apps requires sandboxed iframes, validated/auditable
messages, predeclared resources, and CSP enforcement; for untrusted remote Apps
it recommends a double-iframe sandbox
([security model](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#security-implications),
[sandbox proxy](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#reserved-messages-sandbox-proxy)).

## Implemented POC decision

The POC ultimately uses the official open-source Playwright Trace Viewer rather
than recreating it or making video the primary interaction. The agent first
calls `search_playwright_traces`, selects an opaque trace ID from bounded
metadata, and then calls `render_playwright_trace`. That render tool is the only
tool linked to `ui://playwright-trace-viewer/main.html`; the App provides
conversational follow-up actions and a host-mediated launch into the pinned
Playwright viewer.

The browser never receives a host filesystem path. In the Voice client, a
loopback viewer URL is normalized to the current browser origin, whose
authenticated edge routes proxy only `/trace-viewer/*` and the exact selected
`/api/playwright-traces/{id}/trace.zip` resource to the local MCP process. The
App asks the host to open that validated URL as a normal page because the
official viewer requires a Service Worker, which an opaque-origin MCP App
sandbox cannot register. The optional narrated MP4 remains a separate artifact
and does not open inside the viewer App. Narrated export is intentionally absent
from the direct voice tool set: the agent discovers the deferred Wassette
submission/status tools, so the voice VM receives neither trace filesystem
access nor render credentials.

The completed POC no longer launches Recast or FFmpeg from the host Trace Viewer
process. Its boundary is:

```text
voice -> deferred Wassette tasking component -> loopback Trace Viewer API
      -> trace-render-worker container -> S3-compatible artifact store
      -> local broker TTS -> S3 MP4/manifest/status
```

Wassette has network capability only for the narrow loopback submission API.
The worker runs as UID/GID 65532 with a read-only root filesystem, all Linux
capabilities dropped, `no-new-privileges`, bounded CPU/memory/PIDs, and only
tmpfs scratch storage. It receives no host trace or output mount and no Docker
socket. The trace ZIP, durable job state, bounded renderer log, manifest, and
MP4 are stored below an opaque `trace-renders/{renderId}/` S3 prefix. Only the
broker bearer secret is mounted read-only. The host viewer proxies the finished
MP4 from the worker and does not cache a render directory.

Adobe S3Mock plus its Docker volume is the local POC artifact store; it proves
the S3 contract and restart recovery but is not production durability. A real
S3-compatible service replaces it without changing the tool contract. The
worker scans pending/running S3 job objects at startup. Restarting the container
immediately after submission was verified to preserve the render ID and finish
the same job.

The black-box proof records a real trace, searches through MCP, renders the
selected ID, launches the pinned Trace Viewer in Chromium, and verifies both
the recorded page and click action. The same test reads the MCP App resource,
performs its postMessage lifecycle, launches the validated viewer URL through
the host, and verifies the recorded page and action again in the opened viewer.
