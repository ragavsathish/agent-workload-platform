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
- **Expose only reusable seams.** The C4 compiler and Dagre layout are internal
  TypeScript modules compiled into one engine and one JavaScript runtime.
  `wac-cli` 0.10.1 packages that engine with independently reusable policy and
  checkpoint modules without recompiling the blocks.
- **Use TypeScript guests, not Rust guests.** Cargo may install the pinned WAC
  CLI, but no workload component is implemented or compiled in Rust.
- **Accept one runtime per reusable JavaScript block.** ComponentizeJS embeds
  StarlingMonkey in each independently componentized block. WAC preserves the
  blocks and does not deduplicate their runtimes, so a composed suite is larger
  than one merged component. Merge only modules that lack a real reuse seam.
- **Keep browser execution optional.** Normal C4 compilation has no browser or
  OS imports. Gondolin and Playwright remain a separately built compatibility
  adapter selected explicitly with `C4_LAYOUT_BACKEND=gondolin`.

## Required gates

For a component change, run the workload verification from the repository root:

```sh
make c4-test
```

That command validates WIT, regenerates and type-checks guests, componentizes
and composes the Wasm modules, loads them into Wassette, runs the single-call
compiler and checkpoint smoke tests, and tests the optional converter and
Gondolin adapter. The smoke matrix covers context, container, component,
dynamic, deployment, determinism, and expected rejection cases. The separate
fallback browser artifact build is:

```sh
make c4-gondolin-build
```

The real end-to-end dog-food run is:

```sh
make c4
```

See the [C4 workload README](../../workloads/c4-excalidraw/README.md) for
prerequisites and the complete sequence.
