Feature: Host readiness for the Voice Agent

  Rule: The deployment starts only on a prepared host

    @behavior-preflight-001
    Scenario: A supported host is ready
      Given an Apple Silicon macOS host with at least 8 GiB of memory
      And at least 15 GiB is free on the repository filesystem
      And the required development and runtime tools respond
      And Docker and its Compose capability are available
      And the deployment configuration contains every required nonempty setting
      When host readiness is checked
      Then the check succeeds without changing the host

    @behavior-preflight-002
    Scenario: A missing prerequisite is reported before deployment
      Given a required tool, disk capacity, or deployment setting is missing
      When host readiness is checked
      Then the check fails before deployment
      And tool or disk failures identify the missing prerequisite
      And deployment configuration values are not printed
      And no service is started by the check

    @behavior-preflight-003
    Scenario: An unavailable local model service is visible
      Given the local model endpoint does not respond
      When host readiness is checked
      Then the operator is told that model-backed checks cannot run
      And the endpoint result alone does not change host configuration
