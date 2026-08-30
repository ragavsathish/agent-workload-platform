# Adapters

Concrete implementations at external seams live here: browsers, storage,
model providers, command runners, and other environment-dependent capabilities.

`mermaid-to-excalidraw` is an untouched upstream submodule. `c4-gondolin` owns
the C4 preprocessing and isolated browser implementation around it, keeping
platform changes out of the upstream Git history.
