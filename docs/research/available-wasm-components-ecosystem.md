# Available WebAssembly components: ecosystem and Wassette compatibility

_Research date: 2026-08-31; registry checked again 2026-09-01. Sources are
specifications, project documentation, official repositories, registries, and
CNCF project pages._

## Executive conclusion

There is not yet one catalog of interchangeable WebAssembly tools. The public
ecosystem contains four different things that are routinely called “Wasm
components”:

1. **Component Model binaries** with a typed WIT world — potentially reusable.
2. **WIT packages** — interface definitions, not executable implementations.
3. **Core Wasm modules** using WASI Preview 1 or a product-specific ABI — not
   Component Model components.
4. **Runtime/framework applications** — manifests, assets, components or modules
   packaged for Spin, wasmCloud, containerd, Wasmer, and similar hosts.

For Pi/Wassette/Gondolin, the only public artifacts demonstrated by primary
sources to be directly loadable as Wassette tools are the entries in the
[Wassette registry](https://raw.githubusercontent.com/microsoft/wassette/main/component-registry.json).
Some individual Bytecode Alliance, Spin, and wasmCloud artifacts are genuine
Component Model binaries, but that establishes only **format compatibility**.
Their exported world, imported interfaces, WASI version, OCI layout, and
Wassette tool-schema conversion still have to match. Extism plug-ins,
Proxy-Wasm extensions, OPA policies, runwasi/WasmEdge/Krustlet examples, and
typical Wasmer packages are not drop-in Wassette components.

The practical strategy is therefore to treat the Component Model/WIT boundary
as the compatibility seam, use the Wassette catalog as the first test set, and
adapt or rebuild other artifacts only when their functionality justifies it.

## The compatibility test

A core module follows the WebAssembly Core Specification. A Component Model
component uses a distinct binary layer, can contain core modules, carries
component types, and exchanges WIT values through the Canonical ABI. The
[Component Model FAQ](https://component-model.bytecodealliance.org/reference/faq.html)
shows the operational check: `wasm-tools print artifact.wasm` begins with
`(module` for a core module and `(component` for a component. File suffixes and
OCI transport do not distinguish them.

For this report, **direct Wassette compatibility** means all of the following:

- a Component Model binary, not merely a core module or WIT package;
- loadable through Wassette's supported `file://` or `oci://` path;
- exports that Wassette can expose as MCP tools and translate to JSON Schema;
- imports/WASI versions that Wassette implements, with capabilities granted by
  policy; and
- lifecycle/state assumptions compatible with Wassette's per-call component
  instantiation.

Wassette itself makes this distinction explicit: it requires Components rather
than core modules, and existing MCP servers must be rebuilt for WASI Preview 2
([FAQ](https://microsoft.github.io/wassette/latest/faq.html)). On load it extracts
WIT, maps exported functions to MCP tools, and creates policy-scoped WASI state
for invocation ([architecture](https://microsoft.github.io/wassette/latest/design/architecture.html)).
The current documentation is ahead of this repository's pinned Wassette 0.7.0;
every candidate still needs to be tested against the pinned binary.

## Compatibility matrix

| Artifact/ecosystem | What it actually provides | Format / ABI | Distribution or catalog | Capability and state model | Direct with Wassette? |
|---|---|---|---|---|---|
| **Wassette registry** | Executable MCP-oriented components | Component Model, documented as WASIp2 | Curated JSON; OCI refs on GHCR | Deny-by-default policy for filesystem, network, environment, storage and memory; instance/WASI state constructed per tool call | **Yes, established**, subject to the repo-pinned 0.7.0 and permissions |
| **Official WASI packages** | Standard interface definitions | Versioned WIT packages; WASI 0.2 or 0.3 | GHCR via `wkg`, e.g. `wasi:http@0.2.12` | Interfaces declare capabilities; no implementation or state by themselves | **No** — build-time contracts, not tools |
| **General Component Model artifact** | Typed executable component | Component binary + WIT world + Canonical ABI | File, OCI, or registry | Imports are requested capabilities; resources may carry instance state | **Conditional** on exports, imports, WASI version and OCI layout |
| **WASI-Virt output** | A component composed with virtual WASI implementations | WASIp2 component composition | Locally generated component | Can deny, embed, restrict or pass through clocks, env/config, exit, filesystem, HTTP, random, sockets and stdio | **Conditional and promising**; can remove unsupported/over-broad host imports but cannot fix an incompatible exported world |
| **Individual Spin component** | A guest component used by a Spin app | Current Spin supports Component Model/WASIp2, but inspect each artifact | Local/URL or individual OCI push with `wkg` | Spin trigger world plus manifest-granted files, variables, outbound hosts, key-value/SQL, etc.; state usually external | **Conditional**; format is insufficient if it exports an HTTP trigger or imports Spin interfaces |
| **Spin application OCI artifact** | Manifest + one or more components + files/assets | Spin application archive/layout | `spin registry push`, then `spin up -f` | Spin owns routing, triggers, configuration and component lifecycle | **No** — run with Spin/SpinKube, or extract and audit an inner component |
| **wasmCloud component** | Usually a standard WASI 0.2 component | Component Model; often HTTP export and provider/custom imports | OCI, examples at `ghcr.io/wasmcloud/components/*`; indexed by wasm.directory | Deny-by-default linked capabilities/providers; components are normally stateless, external state via providers | **Conditional**; provider links and HTTP-handler worlds are not supplied by Wassette |
| **wasmCloud provider/application** | Native provider or distributed application definition | wasmCloud-specific provider/archive/manifest | OCI + wasmCloud control plane | NATS lattice, links, providers, declarative lifecycle | **No** |
| **containerd runwasi / SpinKube** | Runtime shims and Kubernetes orchestration | Workload-dependent; public runwasi demo is WASIp1 core module; SpinKube consumes Spin apps | Container/OCI images and `SpinApp` resources | Container/Kubernetes isolation and application lifecycle | **No** — runtime/application layer, not a component catalog |
| **WasmEdge** | Runtime, plug-ins and mostly WASI/core-module workloads | Core Wasm/WASIp1 today; Component Model/WASIp2 remains incomplete | OCI container-style examples, plug-in ecosystem | Runtime flags, plug-ins and host functions | **No** for typical artifacts; reassess after Component Model completion |
| **Krustlet** | Legacy Kubernetes kubelet for Wasm | `wasm32-wasi` core modules | `wasm-to-oci`, e.g. `webassembly.azurecr.io/hello-wasm:v1` | Kubernetes pod lifecycle; old WASI host | **No**; project is not actively maintained |
| **Extism plug-in** | Portable plug-in for Extism hosts | Core Wasm module + Extism PDK/host ABI | GitHub releases/manifests; example `count_vowels.wasm` | Manifest grants host functions, config, memory and network; plug-in memory/state controlled by Extism host | **No** — needs an Extism host or a WIT wrapper |
| **Proxy-Wasm / Envoy** | Event-driven proxy extension | Core Wasm + Proxy-Wasm ABI 0.2.1 | Module fetched locally/inline/remotely by a proxy | Proxy supplies request/stream/context callbacks and shared data | **No** — custom low-level ABI |
| **OPA Wasm** | Compiled policy decision | Core Wasm + OPA ABI 1.x, commonly inside an OPA tar bundle | `opa build -t wasm`; bundle contains `policy.wasm` | Host supplies memory, data, built-ins and evaluation context | **No** — wrap or host it separately |
| **Wasmer Registry / former WAPM** | Wasmer packages and executables | Commonly WASI/WASIX/core modules or Wasmer package formats; artifact-specific | Wasmer Registry, e.g. `wasmer run syrusakbary/cowsay` | Wasmer/WASIX host capabilities and process state | **Not established**; assume no until `wasm-tools` proves component format and WIT audit passes |

## Genuine reusable component sources

### Wassette's curated registry

The live registry currently contains **11** loadable entries:

- JavaScript: `oci://ghcr.io/microsoft/github-js:latest`,
  `memory-js:latest`, `get-weather-js:latest`,
  `get-open-meteo-weather-js:latest`, and `time-server-js:latest`;
- Python: `oci://ghcr.io/microsoft/eval-py:latest`;
- Go: `oci://ghcr.io/microsoft/gomodule-go:latest`; and
- Rust: `arxiv-rs`, `fetch-rs`, `filesystem-rs`, and `brave-search-rs`, all
  under `ghcr.io/microsoft/*:latest`.

`context7-rs` remains an official source example but is not currently listed in
the public registry, so it should not be described as a directly published
catalog entry.

The registry is a small, curated static catalog, not a general component search
index. The [CLI reference](https://github.com/microsoft/wassette/blob/main/docs/reference/cli.md)
documents registry search/get, local and OCI loading, WIT inspection, generated
tool schemas, and policy configuration. The
[publishing guide](https://microsoft.github.io/wassette/latest/cookbook/publishing-to-oci-registries.html)
uses `wkg oci push` and recommends version tags and signatures. For production
experiments, resolve every `latest` entry to a digest and record its extracted
WIT; the Wassette README still calls the project early and not production-ready.

### Official WASI and WIT packages

WASI is the most important source of reusable **contracts**, but its packages
must not be counted as executable implementations. Official WASI 0.2 publishes
separate WIT packages such as `wasi:io`, `random`, `clocks`, `sockets`,
`filesystem`, `cli`, and `http`; the
[0.2.12 release](https://github.com/WebAssembly/WASI/releases/tag/v0.2.12)
lists their exact package versions. `wkg get wasi:http@0.2.1` retrieves an
interface package, not an HTTP client/server component.

[WASI releases](https://wasi.dev/releases) now designate WASI 0.3 as stable and
current. It adds native async functions, futures and streams; 0.2 remains stable
but superseded, while 0.1 is the legacy core-module ABI. The
[interface dashboard](https://wasi.dev/interfaces) classifies clocks, random,
filesystem, sockets, CLI and HTTP as Phase 3; key-value and several other APIs
remain Phase 2 or earlier. Standards stability does not imply availability in
the repo's host: the official WASI 0.3 announcement says Wasmtime 46 enables it
while guest/toolchain support is still landing, and Wassette's own FAQ still
directs components to WASIp2. Target 0.2 for the current pipeline until an
end-to-end 0.3 probe succeeds.

### `wkg`, Warg, wa.dev and wasm.directory

[`wkg`](https://github.com/bytecodealliance/wasm-pkg-tools) is the active
Bytecode Alliance package toolchain for fetching, publishing and composing WIT
packages and components through OCI. Its documented concrete example is
`wkg oci pull ghcr.io/webassembly/wasi/http:0.2.1`. This is infrastructure for a
catalog, not itself a catalog.

[`Warg`](https://github.com/bytecodealliance/registry) is a registry protocol and
reference implementation, not a curated component collection; its repository
was archived in July 2025 and points current work to `wasm-pkg-tools`.
[`wa.dev`](https://wa.dev/wasi:http) is useful for browsing package interfaces
and versions, but a WIT page is not evidence of an executable implementation or
Wassette compatibility. [`wasm.directory`](https://wasm.directory/) is an alpha
meta-registry currently reporting 100 packages, 13 namespaces and 526 versions;
use it for discovery, then verify the underlying artifact and publisher.

One representative true executable is Bytecode Alliance's
[`ghcr.io/bytecodealliance/sample-wasi-http-rust/sample-wasi-http-rust:latest`](https://github.com/bytecodealliance/sample-wasi-http-rust).
It is a `wasi:http/proxy` component and runs with `wasmtime serve`. That makes it
a useful negative/format test: its HTTP handler world is not evidence of a
plain-function MCP tool world.

### WASI-Virt: composition rather than another runtime

[`WASI-Virt`](https://github.com/bytecodealliance/wasi-virt) is unusually relevant
to this platform because it generates virtual WASI Preview 2 implementation
components and composes them with an existing component. It can embed a
read-only filesystem, inject or restrict environment/configuration, deny or pass
through clocks, exit, HTTP, random, sockets and stdio, and eliminate those host
imports from the result. It is a genuine Component Model “Lego” tool and should
be evaluated for shrinking a candidate component's capability surface before
loading it into Wassette. It does not translate an HTTP-trigger export into an
MCP-callable function or update an incompatible WASI version.

### Fermyon Spin

Spin is a CNCF Sandbox framework, not a catalog
([CNCF project page](https://www.cncf.io/projects/spin/)). A Spin application is
a set of components and content governed by `spin.toml`; its OCI artifact from
`spin registry push` contains the application manifest, Wasm binaries and
assets and is consumed with `spin up -f`
([distribution docs](https://spinframework.dev/v4/distributing-apps)). It is not
a single drop-in Wassette component. SpinKube likewise deploys such applications
through `SpinApp` resources and a containerd shim, for example
`ghcr.io/spinframework/containerd-shim-spin/examples/spin-rust-hello:v0.25.0`.

An **individual** current Spin guest may be a standard WASIp2 component and can
be pushed separately using `wkg`; inspect it rather than relying on the word
“component.” Trigger worlds such as `wasi:http/incoming-handler`, Spin-specific
imports, and manifest-provided capabilities normally require Spin. Official
TypeScript templates make Spin a viable source ecosystem under the no-Rust-guest
preference, but rebuilding a function against a Wassette-friendly WIT world is
more promising than trying to load a complete Spin application.

### wasmCloud

wasmCloud is CNCF Incubating
([CNCF](https://www.cncf.io/projects/wasmcloud/)) and its current guest components
target standard WASI 0.2 Component Model binaries. Its
[examples catalog](https://wasmcloud.com/docs/examples/) names real OCI artifacts:
`ghcr.io/wasmcloud/components/blobby`, `oci-registry`, `otel-config`, and
`qrcode`. It also includes TypeScript examples for Axios, Hono, password checking,
stdio and other APIs, though those pages do not establish matching published OCI
artifacts.

wasmCloud components are normally stateless and reach external state through
linked capability providers. Packaging covers components, WIT packages and
native providers, with interfaces under `ghcr.io/wasmcloud/interfaces/*`
([packaging](https://wasmcloud.com/docs/v1/concepts/packaging/)). Only the first
category can even be format-compatible with Wassette. An HTTP export or an
import satisfied by a wasmCloud provider will not be supplied merely by loading
the component in Wassette.

## Runtimes, application bundles and incompatible module ABIs

- [`runwasi`](https://github.com/containerd/runwasi) is a containerd shim
  framework, not a component library. Its public
  `ghcr.io/containerd/runwasi/wasi-demo-app:latest` is built for `wasm32-wasip1`
  in the repository Makefile: a core module packaged in OCI.
- SpinKube is a CNCF Sandbox stack for running Spin applications on Kubernetes,
  not a source of standalone components
  ([CNCF overview](https://www.cncf.io/blog/2026/02/26/exposing-spin-apps-on-spinkube-with-gatewayapi/)).
- WasmEdge is a CNCF Sandbox runtime
  ([CNCF](https://www.cncf.io/projects/wasmedge-runtime/)). Its
  [roadmap](https://github.com/WasmEdge/WasmEdge/blob/master/docs/ROADMAP.md) and
  [Component Model tracking issue](https://github.com/WasmEdge/WasmEdge/issues/4236)
  show Component Model/WASI 0.2 implementation is still incomplete; common OCI
  examples are WASIp1/core-module executables, not a reusable component catalog.
- [Krustlet](https://github.com/krustlet/krustlet) says it is not actively
  maintained. It schedules `wasm32-wasi` modules and its documented
  `webassembly.azurecr.io/hello-wasm:v1` flow predates the Component Model.
- An [Extism plug-in](https://extism.org/docs/concepts/plug-in/) is explicitly a
  WebAssembly module using the Extism PDK/host ABI. The official demo collection
  publishes artifacts such as
  `https://github.com/extism/plugins/releases/latest/download/count_vowels.wasm`.
  They require Extism, regardless of the `.wasm` suffix.
- [Proxy-Wasm](https://github.com/proxy-wasm/spec) defines a low-level,
  event-driven ABI between proxies and extension modules; version 0.2.1 is the
  widely implemented version. Envoy supplies its callbacks and request context.
- [`opa build -t wasm`](https://www.openpolicyagent.org/docs/wasm) emits a core
  module using OPA's memory/import/export ABI 1.x, commonly inside a gzipped-tar
  [OPA bundle](https://www.openpolicyagent.org/docs/management-bundles). It needs
  an OPA host SDK or a new wrapper component.
- [WAPM has been folded into Wasmer Registry](https://docs.wasmer.io/registry/).
  The registry is real and broad, but its Wasmer package/executable model does
  not prove Component Model format. Audit each candidate; WASI, WASIX, WAI or a
  Wasmer manifest is not WIT Component Model compatibility.

These systems can still be useful behind **Gondolin**. Running their native host
inside the VM and exposing a narrow request/result boundary is a legitimate
adapter architecture, but it is process isolation and integration work—not
reuse inside Wassette.

## Recommended test order (no Rust guests)

1. **Establish the acceptance harness.** For every candidate, pin an OCI digest;
   run `wasm-tools validate`, `wasm-tools component wit`, and `wassette inspect`;
   diff imports/exports against a known-good local TypeScript component; load it
   on the repo-pinned Wassette; then invoke every generated MCP tool under the
   minimum policy. Reject core modules before runtime testing.
2. **Test the five official JavaScript registry components first.** Start with
   `time-server-js` (small/no network), then `memory-js`, then the two weather
   components, and finally `github-js` with narrowly scoped network/secrets.
   Test `eval-py` next if Python is acceptable. These are the only no-Rust public
   candidates already curated for Wassette.
3. **Publish one minimal TypeScript control component** through both `file://`
   and digest-pinned OCI. This verifies our Jco/componentize-js, WIT, OCI and
   policy pipeline independently of third-party behavior.
4. **Try WASI-Virt on a controlled TypeScript component.** Embed a small
   read-only asset, remove filesystem/environment imports, and verify that the
   final WIT capability surface shrinks and the result still loads in 0.7.0.
5. **Use format-negative probes deliberately.** Pull the Bytecode Alliance HTTP
   sample and a Spin application OCI artifact to document the precise rejection
   or world mismatch. This prevents future catalog ingestion from treating all
   OCI Wasm as equivalent.
6. **Audit one wasmCloud component, preferably `qrcode`.** Continue only if its
   extracted world has simple callable exports and imports the pinned Wassette
   can satisfy; otherwise use its source as inspiration for a TypeScript
   reimplementation rather than adding a provider/lattice adapter.
7. **Keep incompatible ecosystems outside the hot path.** If an OPA policy,
   Extism plug-in, Spin app, or Wasmer package is uniquely valuable, host it in
   Gondolin or write an explicit Component Model adapter. Do not silently admit
   a second ABI into the Wassette catalog.

The resulting internal catalog should record, for each digest: binary layer,
extracted world, WASI/WIT versions, imports, granted capabilities, state/lifecycle
assumptions, publisher/signature, pinned-runtime test result, and whether it is a
tool, a dependency, or only a template. That metadata is more useful than the
generic label “Wasm component.”
