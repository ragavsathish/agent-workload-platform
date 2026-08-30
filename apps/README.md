# Applications

Reusable runnable applications presented to users or agents live here. An
application may be consumed by multiple workloads without owning their
orchestration.

An unchanged external application should be a submodule pinned to a publicly
fetchable commit. Platform-specific orchestration belongs in its workload or an
adapter, not as edits inside that submodule.
