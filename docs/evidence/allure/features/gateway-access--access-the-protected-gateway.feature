# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Gateway access
Feature: Access the protected gateway

  # Allure result: fa33c61b-f9c1-48b0-840f-b17586d9600f-result.json
  # Validation layer: deployedIntegration; source: voice.playwright.tailnet-owner-integration.tailnet-owner.integration.spec.ts.Tailscale owner reaches Gitea admin and direct header forgery fails
  Scenario: Tailscale owner reaches Gitea admin and direct header forgery fails [fa33c61b]
    Given Gitea is isolated behind the Tailscale-only socket
    When another identity forges a Gitea login header
    Then only the Tailscale owner reaches admin through Serve

  # Allure result: 365d9f6a-3063-43fa-bcbf-ccef031f037d-result.json
  # Validation layer: deployedIntegration; source: voice.playwright.tailnet-owner-integration.tailnet-owner.integration.spec.ts.tailnet routes reject another user before reaching Grafana or Oxigraph
  Scenario: tailnet routes reject another user before reaching Grafana or Oxigraph [365d9f6a]
    Given the deployed tailnet router and configured exact owner
    When another identity requests protected routes
    Then Traefik denies both requests before the backing services respond
    And the configured owner can still query the graph
