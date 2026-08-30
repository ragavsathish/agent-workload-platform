# Wasm, WIT, and TypeScript decisions

This is the short, project-specific version of the guidance in the [detailed
research note](../research/wasm-wit-typescript-best-practices.md).

## Decisions

- **WIT is the contract.** Treat WIT interfaces and worlds as the source of
  truth. Generate TypeScript declarations from the selected world; do not hand-
  maintain boundary types.
- **Type-check separately.** Run `tsc --noEmit` before componentization. Jco can
  bundle TypeScript syntax, but it is not a replacement for semantic type
  checking.
- **Keep worlds small.** A world defines a component's authority boundary. Do
  not add filesystem, network, clock, randomness, or secret-store capabilities
  unless the contract requires them.
- **Disable implicit capabilities.** Deterministic components are built with
  ComponentizeJS features disabled unless a specific capability is approved.
- **Use values for handoffs.** Records and lists are appropriate for immutable
  compilation state and layout snapshots. Use resources only for identity-bearing
  entities with a lifetime.
- **Keep calls coarse-grained.** Validate byte and element limits before
  allocation, and avoid repeated JSON conversions across the same boundary.

## Required gates

For a component change, run the workload verification from the repository root:

```sh
make c4-test
```

That command validates WIT, regenerates and type-checks guests, componentizes the
Wasm modules, loads them into Wassette, runs the checkpoint smoke test, and runs
the converter and Gondolin adapter tests. The separate isolated browser artifact
build is:

```sh
make c4-gondolin-build
```

The real end-to-end dog-food run is:

```sh
make c4
```

See the [C4 workload README](../../workloads/c4-excalidraw/README.md) for
prerequisites and the complete sequence.
