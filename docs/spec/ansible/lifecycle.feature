Feature: Repeated deployment lifecycle convergence

  @behavior-lifecycle-001
  Scenario: Three recreate cycles each satisfy the deployed contract
    Given the deployment can be started and stopped
    When three stop and recreate cycles are performed
    Then every recreated cycle passes the infrastructure verification contract
    And a failed cycle stops the lifecycle test

  @behavior-lifecycle-002
  Scenario: A successful lifecycle test leaves the deployment running
    Given all three recreate cycles passed
    When the lifecycle test completes
    Then the deployment is running
    And final infrastructure verification passes
