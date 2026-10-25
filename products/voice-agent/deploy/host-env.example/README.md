# Native service configuration

These files are the declarative configuration inputs for macOS host services.
`make setup` copies each missing file to the ignored `deploy/host-env/`
directory. Configure secrets in those private copies; do not add secret values
to these examples.

Each service receives only its own file. Ansible copies the configured file to
the service runtime with mode `0600`, and the LaunchAgent uses dotenvx to inject
it when starting the process.

The Pi Durable owner is the long-lived task scheduler and sole writer to its
SQLite task store. Its private HTTP endpoint accepts tasks from the Gateway;
the same process also exposes a local Unix socket for inspection and retry.
`WORKER_PI_EXECUTION_MODE=host` uses native Pi Durable coding tools on the Mac.
`gondolin` runs the same Pi Durable conversation with file and shell tools in
an isolated task VM. The owner runs the conversation directly in both modes.
Host tools have the owner's account filesystem and network access.
