# Workloads

Each directory contains one workload and uses its native package and runtime
commands. There is no shared lifecycle interface or repository-specific CLI.

Keep workload-specific contracts, prompts, examples, and Wasm implementations
inside that directory. Promote an implementation into a shared top-level role
only when another workload actually reuses it.
