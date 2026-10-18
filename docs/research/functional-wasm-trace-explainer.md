# Functional WASI composition for the Playwright trace explainer

_Research date: 2026-10-18. Primary sources only. Repository baseline:
Wassette with WASI 0.2 components, WAC 0.10.1, and a containerized native
Recast/FFmpeg render worker._

## Conclusion

The useful unit to move to WebAssembly is not “the video worker.” It is a
deterministic **trace compiler**:

```text
trace.zip bytes
    -> bounded TraceFacts
    -> evidence-grounded RenderPlan
    -> SRT + sanitized manifest
```

Implement that compiler as Rust WASI components with typed WIT boundaries,
then statically compose them into one `trace-compiler.wasm`. Run the composite
inside the existing worker with Wasmtime first. This moves parsing of an
untrusted archive and the explanation policy behind a tighter sandbox without
forcing large media, credentials, subprocesses, or durable state through an
MCP request.

Keep the following native for the POC: S3 credentials and job recovery, the
TTS broker credential, Playwright Recast, FFmpeg/FFprobe, H.264/AAC encoding,
MP4/subtitle muxing, process limits, and scratch-file cleanup. These are the
imperative shell around the functional WASM core.

Do not expose SHA-256, JSON parsing, or SRT formatting as separate components.
They are good Rust libraries _inside_ a component, but their WIT call and data
copy overhead would produce a fragmented design with no security boundary.
The useful component seams are where policy changes independently or where an
effect/capability must be substituted.

## What “functional composition” should mean here

WIT describes a component's imports and exports using values, records,
variants, results, resources, and interfaces. The Component Model then permits
one component's export to satisfy another component's import. `wit-bindgen`
generates Rust guest bindings, while WAC declares and encodes the graph
([WIT and guest bindings](https://github.com/bytecodealliance/wit-bindgen),
[WAC language and CLI](https://github.com/bytecodealliance/wac)).

The repository already uses exactly this mechanism. Its tasking core imports a
typed `request` function, the Rust HTTP adapter exports it, and `wac plug`
produces the single artifact loaded by Wassette
([tasking WIT](../../products/voice-agent/components/tasking-ts/wit/world.wit),
[tasking composition](../../products/voice-agent/components/tasking-ts/Makefile)).

For trace explanation, apply the same pattern at one larger grain:

```text
                         statically composed trace-compiler.wasm
                    +----------------------------------------------+
                    |                                              |
trace.zip ----------> archive-reader --> fact-normalizer            |
                    |                         |                    |
policy/options -----> render-planner <--------+                    |
                    |       |                                      |
                    |       +--> caption-writer                    |
                    |                 |                            |
                    +-----------------+----------------------------+
                                      |
                            RenderBundle (typed value)
                                      |
                         native durable/media shell
                                      |
                       TTS -> Recast -> FFmpeg -> S3
```

This is functional because the same bounded byte input, options, and policy
version produce the same bundle. Clocks, random values, network calls, object
storage, and process execution do not enter the compiler world. Hashes belong
in the returned provenance, but the shell supplies or verifies job timestamps
and storage metadata.

WASI 0.3 is now the current stable release and adds native `future<T>` and
`stream<T>` support; WASI 0.2 remains runnable on current Wasmtime. Wassette,
however, currently builds and distributes `wasm32-wasip2` components, and this
repository's working components use that target. Start with WASI 0.2 and
version the WIT so a later streaming 0.3 world can coexist
([WASI release status](https://github.com/bytecodealliance/wasi.dev/blob/main/docs/releases/index.md),
[Wassette Rust cookbook](https://microsoft.github.io/wassette/latest/cookbook/rust.html),
[Wasmtime WASI 0.2 example](https://github.com/bytecodealliance/wasmtime/blob/main/examples/wasip2/main.rs)).

## Recommended component and library map

| Pipeline concern | Rust/WASM implementation | WASI fit | Recommendation |
|---|---|---:|---|
| ZIP directory and entry reads | [`zip`](https://github.com/zip-rs/zip2) with default features disabled and only pure-Rust Deflate enabled | Good | Put inside `archive-reader`; enforce entry-count, path, compressed-size, inflated-size, and total-output limits before allocation. The project explicitly documents Wasm support and warns that some default features use non-Rust libraries. |
| Deflate | [`flate2`](https://github.com/rust-lang/flate2-rs) using its default pure-Rust `miniz_oxide` backend | Good | Use indirectly through `zip`, or directly only if trace fixtures prove it is needed. Avoid C zlib backends in the component. |
| JSON and JSONL | [`serde_json`](https://github.com/serde-rs/json) plus line-by-line deserialization | Excellent | Parse each bounded `*.trace` member incrementally. JSONL needs no special crate; split/read bounded lines and deserialize a minimal tagged event enum. |
| SHA-256 | [`sha2`](https://github.com/RustCrypto/hashes) | Excellent | Use as an internal library. RustCrypto documents pure-Rust, `no_std`, and WebAssembly use. Do not make hashing a component boundary. |
| Trace normalization | Repository-specific Rust over typed records | Excellent | Export bounded `trace-facts`; reject unsupported Playwright trace versions and cap actions, frames, errors, text lengths, and URLs. |
| Scene planning | Repository-specific pure Rust | Excellent | Make this the independently versioned policy component. It should have no WASI imports. Port the rules now implemented in `trace-explainer-analysis.mjs`. |
| SRT/caption generation | Small repository-owned formatter | Excellent | SRT emission is deterministic and small enough not to justify another dependency. Keep cues in the typed plan and emit SRT in the composite. If parsing many subtitle formats later becomes a product need, [`subtitler`](https://github.com/subtitle-rs/subtitler) exists, but its Tokio/file-oriented surface is excessive for this writer. |
| JPEG decode, resize, canvas composition | [`image`](https://github.com/image-rs/image), `default-features = false`, `jpeg` only | Good, with testing | Suitable if the WASM compiler must validate or normalize still frames. The project recommends explicit features and warns that default Rayon multithreading can surprise single-threaded Wasm targets. Do not decode every frame unless the plan needs it. |
| HTTP/TTS | `wasi:http/outgoing-handler` or the host SDK wrapper | Good | A WASI component can call the loopback broker if the runtime grants only that authority. The standard interface returns a future response and byte streams; the Wassette policy can deny every other destination ([WASI HTTP interface](https://github.com/WebAssembly/wasi-http/blob/main/proxy.md), [Wassette capability policy](https://microsoft.github.io/wassette/latest/faq.html#security-and-permissions)). Keep the broker token in a narrow effect adapter, not the pure planner. |
| S3/object storage | Presigned HTTPS URLs through `wasi:http`, or a custom host `object-store` WIT import | Conditional | Prefer host-issued, short-lived, method- and key-scoped URLs. The official Rust AWS SDK still has an open WebAssembly support request and requires its Tokio/credential stack ([AWS SDK](https://github.com/awslabs/aws-sdk-rust), [open Wasm support issue](https://github.com/awslabs/aws-sdk-rust/issues/59)). |
| SigV4 | RustCrypto `sha2` + [`hmac`](https://github.com/RustCrypto/MACs), or AWS `aws-sigv4` if it can be compiled in a target-specific spike | Technically possible, strategically poor | Signing is not the hard part; safely provisioning rotating AWS credentials is. Do not give the trace compiler ambient S3 credentials. Sign in the trusted host or issue presigned URLs. |
| Durable state/recovery | Native worker + S3 job records today | Not a pure component concern | Preserve the proven pending/running/completed/failed state machine and restart scan. A request-oriented Wasm runtime does not by itself make work durable. |
| OTel traces, metrics, and logs | Host instrumentation around component calls | Better on host today | Keep telemetry in the worker and attach compiler version, outcome, duration, and bounded error class. The official WASI Observe proposal is still Phase 1, so it is not yet a portable replacement for the worker's OTel SDK ([WASI proposal phases](https://github.com/WebAssembly/WASI/blob/main/docs/Proposals.md)). |
| Video/audio encoding and muxing | Native FFmpeg/FFprobe | Poor | Keep in the constrained container. It is the mature, interoperable path to H.264/AAC/MP4 and `mov_text`. |

### ZIP and JSON are viable, but bound them before trusting them

The `zip` crate is the pragmatic choice because it explicitly supports Wasm
when incompatible features are disabled and includes Deflate support. For a
security-sensitive reader, its `enclosed_name` behavior is useful, but this
pipeline should not extract the archive to a filesystem at all. Read named
members into capped buffers, validate all references, and discard everything
that is not needed for `TraceFacts`
([zip crate capabilities](https://github.com/zip-rs/zip2)).

The WIT 0.2 ABI represents `list<u8>` as a copied value across component
boundaries. That is acceptable for the current roughly sub-megabyte trace POC,
but not a sound assumption at the worker's 256 MiB admission limit. Therefore:

- Compose ZIP read, JSONL parse, normalization, planning, and caption writing
  into one artifact so archive bytes cross the component boundary once.
- Put a lower explicit WASM-analysis size limit in front of the component.
- For larger traces, let the native shell preselect bounded members or wait for
  a WASI 0.3 streaming world; do not route hundreds of megabytes through an MCP
  JSON tool result.
- Never return raw headers, cookies, bodies, DOM snapshots, or console payloads
  from the component. Only return the bounded evidence schema.

### Object storage should be a capability, not a Rust SDK dependency

`wasi:blobstore` describes the right abstraction, but the official proposal is
only Phase 1 and explicitly calls out unresolved handling of large files and
resource/time limits
([WASI Blob Store proposal](https://github.com/WebAssembly/wasi-blobstore/blob/main/README.md),
[current WASI proposal phases](https://github.com/WebAssembly/WASI/blob/main/docs/Proposals.md)).
Wassette does not currently supply an S3 implementation of this proposed
interface.

There are three reasonable storage designs, in descending order for this POC:

1. **Keep S3 in the native worker.** Pass archive bytes into the composed
   compiler and write its small result back to S3. This retains the existing
   credentials and restart model.
2. **Pass presigned URLs to a narrow effect component.** Grant only the S3Mock
   or S3 hostname and use `GET`/`PUT` URLs restricted to one render prefix.
   This moves transfer into WASM without moving credentials or SigV4 policy.
3. **Import a repository-owned `voice:object-store` WIT interface.** Implement
   it in the Wasmtime host today and substitute a standard blob-store provider
   later. This is cleaner than embedding the AWS SDK but is more platform work.

wasmCloud is the strongest open-source example of this provider pattern. Its
components are linked explicitly to host implementations, and its current WIT
catalog includes key-value, messaging, NATS, and blob/object-store interfaces
([wasmCloud interfaces](https://wasmcloud.com/docs/overview/interfaces/),
[component/provider model](https://wasmcloud.com/docs/overview/workloads/components/)).
It is a platform alternative, not a library to drop into Wassette.

### TTS can be a component effect, but should not be part of the pure core

The local broker already presents the ideal boundary: text and voice options
in, PCM bytes out. A Rust effect adapter can implement a small
`voice:tts/synthesize` WIT interface using `wasi:http`, with Wassette or
Wasmtime granting only the broker address. This would make the broker swappable
and keep narration policy independent from transport.

There is also a provider-neutral open-source WIT precedent in
[`golemcloud/golem-ai`](https://github.com/golemcloud/golem-ai): its TTS work
defines provider-independent voices, audio configuration, synthesis results,
and timing information, with Rust WASI provider components
([TTS design and implementations](https://github.com/golemcloud/golem-ai/issues/23)).
Reuse ideas from its types, not the whole broad interface: this trace explainer
needs one bounded synthesis call, PCM metadata, and optional timing marks—not
voice cloning, discovery, or cloud-provider credentials.

## Why native video remains the correct effect provider

Several open-source projects make “FFmpeg in Wasm” sound closer than it is for
a server-side WASI component:

- [`ffmpeg.wasm`](https://github.com/ffmpegwasm/ffmpeg.wasm) is an Emscripten
  and JavaScript/browser port. Its architecture uses Web Workers and an
  in-memory Emscripten filesystem; it is not a WASI Component that can be
  plugged into Wassette
  ([official architecture](https://github.com/ffmpegwasm/ffmpeg.wasm/blob/main/apps/website/docs/overview.md)).
- [`rav1e`](https://github.com/xiph/rav1e) is a serious pure-Rust AV1 encoder
  and exposes a `wasm-bindgen` feature, but that is a core/browser Wasm route,
  not evidence that its full pipeline is a tested `wasm32-wasip2` component.
  It also solves only AV1 encoding—not AAC audio, MP4/WebM muxing, subtitle
  tracks, FFprobe validation, or Recast composition.
- [`image`](https://github.com/image-rs/image) is suitable for still-image
  decode and transforms but is not a video encoder or container muxer.

A custom pure-Rust route could decode JPEGs, feed raw frames to rav1e, encode
audio separately, and add a container writer. That would change the output
codec/container, sacrifice FFmpeg's tested filter/mux behavior, substantially
increase CPU and memory risk inside the Wasm sandbox, and create a media stack
the team must qualify. It does not improve the current threat boundary enough
to justify the work.

Treat native FFmpeg as an implementation of a narrow conceptual effect:

```wit
interface media-renderer {
    render: func(bundle-url: string, output-url: string)
        -> result<rendered-media, render-error>;
}
```

That interface can be invoked over HTTP today. A future host provider may
implement it differently, but the pure trace compiler does not know or care.

## Runtime and composition choices

| Runtime/tool | What it is good at | Limitation for this job | Role here |
|---|---|---|---|
| [`wit-bindgen`](https://github.com/bytecodealliance/wit-bindgen) | Generates guest bindings from WIT; Rust supports native `wasm32-wasip2` | Tooling remains pre-1.0 and versions can break source generation | Generate Rust bindings and pin it. |
| [`cargo-component`](https://github.com/bytecodealliance/cargo-component) | Cargo-like authoring and component dependencies | Its own README still labels it experimental | Optional authoring convenience; plain Rust `wasm32-wasip2` + `wit-bindgen` is sufficient and closer to Wassette's cookbook. |
| [`wasm-tools`](https://github.com/bytecodealliance/wasm-tools) | Inspect, validate, adapt, print, and manipulate components | Its old `wasm-tools compose` command is deprecated | Validate artifacts and inspect exported WIT; do not adopt its deprecated composer. |
| [`wac`](https://github.com/bytecodealliance/wac) | Declarative static component composition; `plug`, `compose`, and interface conformance checks | Young tool and language; pin exact CLI as this repository already does | Compose the trace compiler and its effect adapters. |
| [`wkg`](https://github.com/bytecodealliance/wasm-pkg-tools) | Fetch, lock, build, and publish WIT/component packages through OCI | Still evolving and not required for a local POC | Adopt after the repository has a second consumer of the trace WIT packages. |
| [`Wasmtime`](https://github.com/bytecodealliance/wasmtime) | Embeddable, configurable runtime for WASI and Components | The embedding must supply limits and capabilities | First host for `trace-compiler.wasm` inside the worker. |
| [`Wassette`](https://github.com/microsoft/wassette) | MCP exposure, deny-by-default filesystem/network/environment authority, OCI distribution | Official README says early development; invocation is an MCP request, not a durable media job | Keep the submit/status façade and policy gate. Do not make it the render queue. |
| [Spin](https://github.com/spinframework/spin) | HTTP/event-triggered components with outbound HTTP, key-value, SQLite, and host-provided services | Persistent stores do not automatically provide workflow replay or exactly-once job execution; cron/SQS are separate trigger plugins | A possible HTTP host for the compiler, not an improvement over the current queue for this POC. |
| [wasmCloud](https://github.com/wasmCloud/wasmCloud) | Dynamic WIT linking plus swappable messaging/blob/key-value providers and NATS distribution | A larger platform adoption; components are primarily reactive and durability semantics come from the chosen broker/provider | Consider if many services need the same portable capability providers. |
| [Golem](https://github.com/golemcloud/golem) | Durable WASM Component execution with an operation log, replay, retry policies, and idempotency | Replaces the current job-runtime model and introduces a new platform; external HTTP still requires remote idempotency for uncertain in-flight calls | Best future alternative if the coordinator itself must become durable WASM. |

Golem is materially different from Spin or Wassette here. It records host-side
interactions in an append-only operation log, reuses completed results during
recovery, and retries an uncertain HTTP request with the same idempotency key.
Its documentation is also explicit that exactly-once effects beyond its network
boundary still require the remote service to honor that key
([Golem durable execution](https://learn.golem.cloud/v1.6/concepts/durable-execution),
[durability controls](https://learn.golem.cloud/v1.6/develop/durability)).
If the S3 job-record protocol becomes difficult to maintain, Golem is the
open-source WASI-native system to spike before inventing more orchestration.
It is not needed merely to sandbox ZIP parsing.

## Proposed WIT boundary

Use repository-owned domain types and make bounds part of the contract. A
condensed starting point is:

```wit
package voice:trace-explainer@0.1.0;

interface types {
    enum fact-kind {
        action,
        navigation,
        assertion,
        request-failure,
        console-error,
    }

    enum outcome {
        observed,
        succeeded,
        failed,
        unknown,
    }

    record limits {
        max-archive-bytes: u64,
        max-entry-bytes: u64,
        max-events: u32,
        max-frames: u32,
        max-scenes: u16,
        max-text-bytes: u32,
    }

    record trace-fact {
        sequence: u32,
        kind: fact-kind,
        monotonic-ms: u64,
        page-id: string,
        action: option<string>,
        target: option<string>,
        outcome: option<outcome>,
        frame-ref: option<string>,
    }

    record scene {
        sequence: u16,
        frame-ref: string,
        heading: string,
        narration: string,
        minimum-duration-ms: u32,
    }

    record render-bundle {
        schema-version: u16,
        source-sha256: string,
        policy-version: string,
        scenes: list<scene>,
        srt: string,
        warnings: list<string>,
    }

    variant compile-error {
        limit-exceeded(string),
        invalid-archive(string),
        unsupported-trace-version(u16),
        invalid-event(string),
        insufficient-evidence(string),
    }
}

interface compiler {
    use types.{limits, render-bundle, compile-error};
    compile: func(trace-zip: list<u8>, limits: limits)
        -> result<render-bundle, compile-error>;
}
```

The internally composed reader and planner can use a richer private WIT
package. The public composite should export one coarse `compile` call so the
archive crosses linear-memory boundaries only once. Do not put S3 URLs,
credentials, wall-clock time, job state, or FFmpeg command lines in this pure
world.

The rendered bundle should reference frames by validated archive member ID or
content digest. The native shell materializes only those selected frames for
Recast/FFmpeg. It should re-check the returned source digest and all references
before rendering; the WASM sandbox limits impact, but its output is still
untrusted input to native media tools.

## Incremental adoption plan

### Phase 1: one composed compiler inside the current container

1. Define versioned domain WIT and golden JSON fixtures for `TraceFacts` and
   `RenderBundle`.
2. Port the existing bounded JavaScript analysis to pure Rust. Use `zip`,
   `serde_json`, and `sha2`; keep SRT emission repository-owned.
3. Initially build one Rust component. Split reader and planner only after the
   behavior is stable, then use the already pinned WAC tool to compose them.
4. Embed Wasmtime in the worker or invoke a small sidecar host. Grant no
   network, filesystem, environment, clocks, or random capabilities to the
   compiler. Set fuel/epoch timeout and memory/table limits at the host.
5. Differentially evaluate the Rust compiler against the current JavaScript
   analysis on retained traces. Compare facts, selected evidence, narration,
   timings, and rejection behavior—not byte-for-byte prose alone.
6. Keep the existing native worker path as rollback until the new compiler has
   passed the real Trace Viewer black-box corpus.

This phase reduces risk without changing the MCP contract, S3 layout, TTS
broker, durable state machine, or final MP4 format.

### Phase 2: separate policy from archive mechanics

After the first component is stable, define a private `facts -> plan` WIT
interface and compose:

```text
archive-reader.wasm + planner.wasm + captions.wasm
                    --wac--> trace-compiler.wasm
```

Keep `captions` combined with `planner` unless another consumer actually needs
it. The meaningful benefit of the split is independently upgrading and testing
the explanation policy while keeping the version-aware Playwright reader
fixed.

### Phase 3: move effects only when the host abstraction pays off

- Add a minimal `voice:tts` effect component if more than one TTS provider or
  runtime needs the same contract.
- Add a custom `voice:object-store` import, or presigned URLs, if the compiler
  must operate outside the worker container.
- Evaluate Golem only if durable orchestration itself is being replaced.
- Evaluate wasmCloud only if portable storage/messaging providers are becoming
  a platform-wide requirement.
- Revisit WASI 0.3 streams after Wassette and the repository toolchain support
  them together; do not mix preview generations in the initial POC.

## Decision for this repository

Adopt **functional core, capability shell**:

- **Wassette/WASM now:** MCP submit/status tools and least-authority loopback
  HTTP adapter.
- **New WASM POC:** deterministic trace compiler, statically composed with WAC
  and hosted by Wasmtime inside the render container.
- **Native container:** durable S3 job lifecycle, presigned/access-controlled
  object transfer, broker authentication, Recast, FFmpeg, health checks, OTel,
  and process supervision.
- **Future durable-WASM candidate:** Golem, only if replacing the native job
  coordinator becomes an explicit goal.

This preserves the proven sandbox order—Wassette with S3-facing mediation,
then a constrained container, with a stronger VM only if needed—while moving
the most security-sensitive deterministic work into portable, independently
testable components.
