Feature: Manage native Voice Agent services

  Rule: A requested lifecycle action reaches an observable state

    @behavior-native_services-001
    Scenario: An unsupported action is refused
      Given an action other than start, stop, restart, or status
      When native service management is requested
      Then the request fails before changing services

    @behavior-native_services-002
    Scenario: Start and restart wait for readiness
      Given the declared native services are installed
      When start or restart is requested
      Then all declared services reach the running state
      And protected native endpoints reject unauthenticated requests
      And music models report initialized readiness

    @behavior-native_services-003
    Scenario: Stop leaves declared services unloaded
      Given the declared native services may be running
      When stop is requested
      Then they are stopped in reverse configured order
      And each declared service is observed as unloaded

    @behavior-native_services-004
    Scenario: Status observes without changing service state
      Given the declared native services have any current state
      When status is requested
      Then each service's observed state is reported
      And no lifecycle change is requested
