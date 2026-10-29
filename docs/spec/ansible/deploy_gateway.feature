Feature: Deploy a changed Agent Gateway

  @behavior-deploy_gateway-001
  Scenario: A targeted gateway update converges
    Given the deployment has valid configuration and build inputs
    When an Agent Gateway update is requested
    Then the Agent Gateway is rebuilt and recreated
    And the operation waits for the updated service to be ready
