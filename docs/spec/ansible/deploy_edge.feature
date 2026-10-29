Feature: Deploy a changed Voice Edge

  @behavior-deploy_edge-001
  Scenario: A targeted edge update converges
    Given the deployment has valid configuration and build inputs
    When a Voice Edge update is requested
    Then the Voice Edge is rebuilt and recreated
    And the operation waits for the updated service to be ready
