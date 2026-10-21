# Voice Agent WASM components

Each component is an independent build module with the same Make interface:

```bash
make -C components/<component> setup
make -C components/<component> build
make -C components/<component> check
make -C components/<component> install
make -C components/<component> clean
```

The Voice Agent Makefile discovers the declared component list and orchestrates
that interface:

```bash
make wasm-setup
make wasm-build
make wasm-check
make wasm-install
make wasm-clean

# One component, when iterating locally:
make wasm-build-tasking-ts
```

The TypeScript components use the Bytecode Alliance Jco/ComponentizeJS toolchain
for their pure core and WAC for composition with their Rust WASIp2 HTTP adapter.
Jco and ComponentizeJS are pinned in each package lockfile; WAC is pinned to the
version declared by each component Makefile and must be available on `PATH`.
The Rust arXiv component compiles directly to `wasm32-wasip2` in its pinned
builder image. Build details, sources, lockfiles, and output paths remain local
to each component; the orchestrator knows only the common Make interface.
