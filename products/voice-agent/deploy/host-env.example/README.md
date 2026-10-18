# Native service configuration

These files are the declarative configuration inputs for macOS host services.
`make setup` copies each missing file to the ignored `deploy/host-env/`
directory. Configure secrets in those private copies; do not add secret values
to these examples.

Each service receives only its own file. Ansible copies the configured file to
the service runtime with mode `0600`, and the LaunchAgent uses dotenvx to inject
it when starting the process.
