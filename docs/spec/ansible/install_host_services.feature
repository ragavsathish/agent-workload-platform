Feature: Install native services for the Voice Agent

  Rule: Prepared assets converge to a private, runnable host installation

    @behavior-install_host_services-001
    Scenario: Required inputs are checked before installation
      Given a supported macOS host
      And prepared application assets, executable dependencies, and service environments
      When host installation begins
      Then missing inputs stop the installation
      And nonsecret missing assets are identified
      And service environment files must be nonempty and readable only by their owner

    @behavior-install_host_services-002
    Scenario: Runtime files and credentials are installed privately
      Given all required inputs are present
      When the host installation converges
      Then runtime and asset files are installed in their intended directories
      And credentials and service environments retain owner-only permissions
      And secret values are absent from the installation report
      And evaluation code is excluded from the production runtime

    @behavior-install_host_services-003
    Scenario: Installed native services become ready
      Given the host runtime and service definitions are installed
      When native services are loaded
      Then each declared service reaches the running state
      And the private durable-owner socket is owner-only
      And protected health endpoints reject unauthenticated requests
      And model and host-metric endpoints report readiness

    @behavior-install_host_services-004
    Scenario: Superseded service files are removed
      Given the installation contains a retired runtime or service definition
      When installation converges
      Then the retired files no longer participate in the running deployment
      And the current service definitions remain valid
