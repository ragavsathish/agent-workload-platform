# Characterization examples for the current product journey.
# These examples are not wired to a Gherkin runner. See plan.md for executable evidence.
Feature: Continue requested work as a durable task
  As the owner of a Voice Agent session
  I want requested work to continue as a Pi Durable task
  So that I can follow its progress and retrieve its result later

  @slice-01-001 @current
  Scenario: Submit a scratch task from an active Pi session
    # Contracts: @bc-c1-003 @bc-c2-001 @bc-c8-001
    Given I have an active owner-scoped Pi session
    When I ask Pi to submit bounded work in the scratch workspace
    Then a native Pi Durable task is created for my identity
    And the returned task ID appears in my Flutter task board
    And the task has no approval action between submission and execution

  @slice-01-002 @current
  Scenario: Follow and retrieve a completed task
    # Contracts: @bc-c2-001 @bc-c2-005 @bc-c8-002
    Given I submitted a scratch task that creates a uniquely named file
    When I choose to listen to that task's progress
    Then I receive bounded progress for the same task ID
    When the task completes and I download its workspace ZIP
    Then the ZIP contains the requested file with its expected contents

  @slice-01-003 @current
  Scenario: See a task submitted through the native CLI
    # Contracts: @bc-c2-001 @bc-c8-002
    Given the CLI uses the exact identity of my Voice Agent login
    When it submits an owner-scoped task to Pi Durable
    Then the same native task ID is visible in my Flutter task board

  @slice-01-004 @current
  Scenario: Reject a request outside the owner's boundary
    # Contracts: @bc-c2-003 @bc-c8-001
    Given a task request lacks valid gateway credentials or names another owner
    When the request reaches the Task Gateway
    Then it is rejected without exposing that owner's task result
