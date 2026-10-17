# arXiv Wassette component

The voice orchestrator uses a vendored copy of Wassette's arXiv component. Only
`examples/arxiv-rs` is retained; a Git subtree is deliberately not used because upstream does not
publish that directory as an independent subtree branch. The source snapshot and license are kept
here so normal deployment does not need to clone GitHub.

The upstream v0.8.0 example calls three HTTP URLs; arXiv redirects them to HTTPS, while the
component treats the redirect as an error. The local source uses HTTPS. It also accepts ISO
`YYYY-MM-DD` dates and replaces upstream's invalid open-ended `submittedDate:[... TO *]` query with
a valid bounded range. The raw `download-paper` tool is replaced by `read-paper-pages`, which
downloads a PDF into component memory, extracts a requested range with `lopdf`, and returns text
only. No PDF bytes or host path cross the MCP boundary.

The build is pinned to:

- repository: `https://github.com/microsoft/wassette.git`
- tag: `v0.8.0`
- commit: `742ebb7236273dad2d88c415eabe872d3b95dff9`
- target: `wasm32-wasip2`
- builder base: Rust 1.92.0 Bookworm image pinned by digest in `Makefile`
- Rust toolchain: upstream's pinned `1.97.1`
- PDF parser: `lopdf` `0.44.0`, pinned exactly in `Cargo.toml` and `Cargo.lock`

The generated `dist/arxiv_rs.wasm` is intentionally ignored. Rebuild it from the pinned source and
install it into the voice service's private component directory with:

```bash
make -C products/voice-agent/components/arxiv-rs build
make -C products/voice-agent/components/arxiv-rs install
```

`Cargo.lock` records the dependency resolution because upstream does not ship one for this
standalone example. Every build enforces it with `--locked`.
The build runs in Docker so it does not depend on the host's Xcode/Command Line Tools linker.

Normal `make up` and `make install-host-services` runs install the component before restarting the
voice service. The generated artifact is rebuilt only when its lockfile, patch, or build definition
changes.

Installation replaces the upstream catalog's `microsoft_arxiv-rs` component with the local
`arxiv_rs` build and grants it network access only to `export.arxiv.org`. No filesystem,
environment-variable, or process permission is granted. PDF input is limited to 25 MiB, parser
decompression to 64 MiB, extraction to eight pages per call, and returned text to 18,000
characters.

The patch is a temporary compatibility fix. Remove this package after the upstream example uses
HTTPS and the voice deployment has moved to that release.
