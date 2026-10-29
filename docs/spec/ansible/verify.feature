Feature: Verify the deployed Voice Agent infrastructure

  Rule: Running services satisfy their declared deployment contract

    @behavior-verify-001
    Scenario: Containers and one-shot jobs have the expected state
      Given the deployment is running on a supported host
      When infrastructure is verified
      Then each declared long-running service is present and running
      And each declared initialization job has exited successfully

    @behavior-verify-002
    Scenario: Container isolation matches the declared policy
      Given the deployment is running
      When container configuration is inspected
      Then each service has its declared filesystem, capability, privilege, logging,
        port, and mount policy
      And no service receives the host Docker socket unexpectedly
      And sensitive data stores use their declared persistent or read-only mounts

    @behavior-verify-003
    Scenario: Private endpoints reject unauthenticated access
      Given the protected metrics, model, gateway, and Grafana surfaces are reachable
      When they are queried without a capability or owner identity
      Then each returns its declared unauthorized response

  Rule: The deployed stack exposes usable routes, data, and telemetry

    @behavior-verify-004
    Scenario: Host services and application probes are ready
      Given the declared native services are installed
      When their running state and operator-visible endpoints are inspected
      Then every declared native service is running
      And music generation models and the voice input filter report readiness
      And the Grafana MCP probe returns a trace identifier

    @behavior-verify-005
    Scenario: Authenticated ingress is checked when available
      Given the tailnet is authenticated
      When its owner routes and public routing configuration are inspected
      Then the owner can reach the declared voice and metrics routes
      And the voice and source routes use their declared ingress paths

    @behavior-verify-006
    Scenario: Data and source services answer without mutation
      Given the knowledge store and source mirror are running
      When a bounded graph query and source lookup are made
      Then the graph query succeeds and the source is reachable
      And service identities and limited token permissions match their declarations

    @behavior-verify-007
    Scenario: Telemetry has reached the metrics store
      Given native host, Docker VM, and Gondolin metrics endpoints are available
      When the metrics store is queried for each source
      Then every source has at least one ingested series
      And the check does not claim that a fresh user journey succeeded

    @behavior-verify-008
    Scenario: Unauthenticated ingress is reported as unjudged
      Given the tailnet is not authenticated
      When infrastructure verification reaches the ingress checks
      Then authenticated ingress checks are explicitly skipped
      And no passing owner-route claim is made
