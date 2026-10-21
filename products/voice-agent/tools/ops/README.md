# Operational commands

These commands implement stateful local operations exposed through the root
`Makefile`. Run the corresponding Make target rather than invoking a module
directly so dependency and environment selection stays consistent.

- `login.py` completes Tailscale authentication and publishes local services.
- `db_init.py` converges database schemas, queues, and roles.
- `gitea_sync.py` converges Gitea identities and publishes `main` plus the
  checked-out branch. It leaves other remote branches untouched.
- `warm_models.py` warms the configured inference models through the edge.
- `digital_twin.py` validates, loads, queries, and captures digital-twin data.
- `make pi-rpc-host-smoke` exercises the local Agent Task worker, Rust RPC
  host, Pi, and Gondolin path without installing or restarting deployed services.

The `deploy/` directory remains limited to deployment definitions and the
configuration generators that materialize those definitions.
