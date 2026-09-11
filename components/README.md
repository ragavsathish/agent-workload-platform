# Components

Reusable WIT/WebAssembly modules live here after at least two workloads depend
on the same interface and implementation. Workload-specific modules remain
inside their workload directory. WAC compositions also stay with the workload
that owns the resulting suite; composition does not require recompiling its
component blocks.

The root-level `.wasm` entries are relative symlinks to every first-party
component accepted by Wassette. They provide one discovery location without
moving workload-owned sources or generated artifacts. Run `make c4-build` to
build their targets:

- `c4-engine.wasm`
- `c4-compiler.wasm`
- `excalidraw-policy.wasm`
- `excalidraw-core.wasm`
- `c4-suite.wasm`
