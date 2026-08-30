# Pipeline module interface

Each immediate child directory is one pipeline module. Its directory name is
the stable name accepted by the root `pipeline` command.

A pipeline must provide three executable entrypoints:

```text
pipelines/<name>/
├── setup.sh   # install/build dependencies and runtime assets
├── check.sh   # deterministic validation and tests
└── run.sh     # execute one job; document arguments in the pipeline README
```

Keep pipeline-specific contracts, prompts, examples, and Wasm implementations
inside that directory. Put an implementation under `apps/` or `packages/` only
after a second pipeline reuses it; that is when the adapter seam is real.

Entry points must resolve paths relative to their own location and must not
depend on the caller's working directory.
