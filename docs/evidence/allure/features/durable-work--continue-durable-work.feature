# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Durable work
Feature: Continue durable work

  # Allure result: 26d8a55d-4259-40e7-bc82-8d7925ab2e83-result.json
  # Validation layer: integration; source: voice.playwright.pi-durable-mcp-integration.pi-durable-mcp.integration.spec.ts.A completed Pi Durable task accepts a follow-up through its session socket
  Scenario: A completed Pi Durable task accepts a follow-up through its session socket [26d8a55d]
    Given a completed native task conversation
    When the voice agent attaches and asks a follow-up
    Then the same conversation returns the follow-up answer

  # Allure result: 1b2f2d8b-0c38-4fb3-b69c-10176122134e-result.json
  # Validation layer: journey; source: voice.playwright.durable.durable.spec.ts.I submit a task from a voice session and follow it in Flutter
  Scenario: I submit a task from a voice session and follow it in Flutter [1b2f2d8b]
    Given the active voice session and Pi Durable owner are available
    When I ask Pi in this session to submit a scratch task
    Then I follow the same native task in the Flutter task board
    When I choose Listen to agent for this task
    Then the isolated worker completes the queued task
    And I retrieve the completed workspace artifact through the browser
    And the browser reports no unexpected errors

  # Allure result: d925d7d9-bb67-46b3-bbcf-0cd99cec8aa3-result.json
  # Validation layer: integration; source: voice.playwright.pi-durable-mcp-integration.pi-durable-mcp.integration.spec.ts.Pi Durable session selects host or Gondolin tools without changing the answer
  Scenario: Pi Durable session selects host or Gondolin tools without changing the answer [d925d7d9]
    Given deployment mode host and a task workspace
    When the owner starts the native Pi session
    Then the answer is returned through the same task contract
    Given deployment mode gondolin and a task workspace
    When the owner starts the native Pi session
    Then the answer is returned through the same task contract

  # Allure result: c7b7e83c-fd30-4a03-801b-d88f12b6cf3a-result.json
  # Validation layer: integration; source: voice.playwright.pi-durable-mcp-integration.pi-durable-mcp.integration.spec.ts.Pi Durable writes through a real Gondolin task VM
  Scenario: Pi Durable writes through a real Gondolin task VM [c7b7e83c]
    Given a task workspace mounted in a Gondolin VM
    When Pi Durable calls its write tool
    Then the VM write appears in the mounted workspace

  # Allure result: 2fed530a-5d45-4f7a-b2fa-75be377d1f0b-result.json
  # Validation layer: integration; source: voice.playwright.pi-durable-mcp-integration.pi-durable-mcp.integration.spec.ts.Pi agent calls an allowlisted product MCP tool
  Scenario: Pi agent calls an allowlisted product MCP tool [2fed530a]
    Given a Pi Durable agent connects to one allowlisted journal MCP server
    When the agent receives a journal review request
    Then Pi calls the MCP tool and returns the agent answer

  # Allure result: 7398b205-b367-4fd5-bb04-4d4a67d8837f-result.json
  # Validation layer: integration; source: voice.playwright.pi-durable-mcp-integration.pi-durable-mcp.integration.spec.ts.Repository task VM receives only its repository writer
  Scenario: Repository task VM receives only its repository writer [7398b205]
    Given Pi JSON declares this repository and its writer credential exists
    And a task for another repository cannot use that declaration
    When the native Pi task starts its VM
    Then Pi runs the repository Clojure hooks with only its writer credential
    And the VM network route denies other Gitea repositories

  # Allure result: cdf001a5-8326-4871-a6c9-928ab8a9bc8e-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.completed work with a missing artifact returns an explicit lookup failure
  Scenario: completed work with a missing artifact returns an explicit lookup failure [cdf001a5]
    Given the C2 owner completes work but the artifact store loses the ZIP
    When I submit a scratch task directly
    Then the public result remains completed and artifact lookup returns 404

  # Allure result: cde75cb5-0de9-48d3-ac8a-b429761c070d-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.directly submitted scratch task completes through the Flutter board and returns its workspace
  Scenario: directly submitted scratch task completes through the Flutter board and returns its workspace [cde75cb5]
    Given the C2 durable service starts with a fresh scratch scenario
    When I submit a scratch task directly to the owner route
    And I follow the same task in the Flutter task board
    Then the completed task exposes a verifiable ZIP artifact
    And the browser reports no unexpected errors

  # Allure result: 1b70173b-fa0c-4bb4-8566-d4b1eeabc9c0-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.durable task board stays usable across mobile, tablet, and desktop
  Scenario: durable task board stays usable across mobile, tablet, and desktop [1b70173b]
    Given the task board opens at mobile resolution
    Given the task board opens at tablet resolution
    Given the task board opens at desktop resolution
    Then the browser reports no unexpected errors

  # Allure result: b36d24f2-a590-450f-98ea-3c7f3f955c4f-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.invalid work never reaches Pi Durable or exposes a workspace artifact
  Scenario: invalid work never reaches Pi Durable or exposes a workspace artifact [b36d24f2]
    Given a fresh durable service rejects an empty task submission
    Then no task record was created for invalid input

  # Allure result: 8ef24bca-7878-401d-9325-788664c73bad-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.owner-unavailable is visible at the task contract
  Scenario: owner-unavailable is visible at the task contract [8ef24bca]
    Given the owner-unavailable C2 scenario is selected
    When the session submits directly to the task contract
    Then the task contract reports the direct submission outcome

  # Allure result: 74dd040e-8cf1-492c-97ec-da455a0fb87f-result.json
  # Validation layer: integration; source: voice.playwright.task-diagram.task-diagram.spec.ts.renders persisted task diagrams
  Scenario: renders persisted task diagrams [74dd040e]
    Given a completed task has a persisted diagram response
    When I open the completed task diagram
    Then the persisted diagram appears in a sandboxed app
    And the browser reports no unexpected errors

  # Allure result: 87314ac9-254a-4ef6-9247-fce05a13411e-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.repository-unavailable is visible at the task contract
  Scenario: repository-unavailable is visible at the task contract [87314ac9]
    Given the repository-unavailable C2 scenario is selected
    When the session submits directly to the task contract
    Then the task contract reports the direct submission outcome

  # Allure result: 59d27097-e487-48e5-942b-205a111b8e70-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-owner-c2.packages.tasking.tests.infrastructure.test_pi_durable_owner_mock#test_owner_client_failure_abort_and_retry
  Scenario: test_owner_client_failure_abort_and_retry [59d27097]
    Given the C2 owner reports a failed task
    When the product retries it, the failure remains visible
    When a parked task is retried, it completes
    When active work is aborted, queries report cancellation
    Then an unavailable owner surfaces a bounded error

  # Allure result: ab89bfc5-f265-4e1a-a74b-f1c4dcfad0cb-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-owner-c2.packages.tasking.tests.infrastructure.test_pi_durable_owner_mock#test_owner_client_lifecycle_and_idempotency
  Scenario: test_owner_client_lifecycle_and_idempotency [ab89bfc5]
    Given a reachable C2 owner with a scratch task contract
    When the product submits the same request twice
    Then single and batch queries return the completed public result
    And a terminal abort leaves the result intact
    But reusing the request ID with different input is rejected

  # Allure result: 619e0f79-576c-4165-bab1-50f0d53cdde7-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.voice session submits directly to Pi Durable and I follow the task in Flutter
  Scenario: voice session submits directly to Pi Durable and I follow the task in Flutter [619e0f79]
    Given I am in my voice session and the Pi Durable owner is available
    When I ask Pi in this session to submit a scratch task
    Then the Flutter task board follows that same submitted task
    Then the task result and its artifact are available through the web UI
    And the browser reports no unexpected errors

  # Allure result: cb79bc29-27de-45e2-9551-9fd9d08f3a6c-result.json
  # Validation layer: integration; source: voice.playwright.durable-c2-mock.durable-c2-mock.spec.ts.worker-failed is visible at the task contract
  Scenario: worker-failed is visible at the task contract [cb79bc29]
    Given the worker-failed C2 scenario is selected
    When the session submits directly to the task contract
    Then the task contract reports the direct submission outcome
