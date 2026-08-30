# Runtimes

Shared runtime integration belongs here. Pi coordinates workloads, Wassette
runs composed WebAssembly suites, and Gondolin supplies optional isolated QEMU
fallbacks. For the C4 workload, Wassette loads `c4-suite.wasm` while Pi invokes
its typed tools. C4-specific orchestration stays in
`workloads/c4-excalidraw`.
