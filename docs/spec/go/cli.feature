Feature: Command-line access to host image workflows

  @behavior-cli-001
  Scenario: A local Compose pull validates its input first
    Given a caller supplies a rendered Compose configuration, revision, architecture, and run ID
    When the caller starts a local Compose pull
    Then invalid configuration is rejected before Docker access
    And a valid pull returns a cache result

  @behavior-cli-002
  Scenario: A local image build validates its context
    Given a caller supplies a build manifest and context archive
    When the caller starts a local image build
    Then the context size and SHA-256 must match the manifest before Docker access

  @behavior-cli-003
  Scenario: A VM requests a Compose cache through the host API
    Given the VM has a rendered Compose configuration, run ID, and API token
    When it requests Compose preparation through the host API
    Then the host job is authenticated and polled to completion
    And progress is printed without repeating prior segments

  @behavior-cli-004
  Scenario: VM API access requires a token
    Given the VM has no host job API token
    When it requests a Compose pull or image build through the API
    Then the command fails before submitting host work

  @behavior-cli-005
  Scenario: A VM builds an image through the host API
    Given a workflow has a matching artifact version and supported build inputs
    When it submits the image job and streams its context with authentication
    Then it polls for a result and writes the handoff result for the workflow

  @behavior-cli-006
  Scenario: An image export reports its handoff
    Given an image is available on the host
    When the caller exports it as an archive
    Then the command returns the image reference and archive location
