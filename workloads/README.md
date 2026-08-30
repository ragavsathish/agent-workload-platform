# Workload module interface

Each immediate child directory is one workload module. Its directory name is
the stable name accepted by the root `workload` command.

A workload must provide three executable entrypoints:

```text
workloads/<name>/
├── setup.sh   # install/build dependencies and runtime assets
├── check.sh   # deterministic validation and tests
└── run.sh     # execute one job; document arguments in the workload README
```

Keep workload-specific contracts, prompts, examples, and Wasm implementations
inside that directory. Promote an implementation into a shared top-level role
only when another workload actually reuses it.

Entrypoints must resolve paths relative to their own location and must not
depend on the caller's working directory.
