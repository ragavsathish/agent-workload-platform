# C8 owns the session, workspace mount, and capability surface of an execution.
Feature: Agent execution

  Rule: Execution is bounded by the task's granted capability

    @bc-c8-001 @current
    Scenario: A task receives only its selected workspace capability
      Given an accepted task names one selected workspace and execution mode
      When an agent session is prepared
      Then its tools and mounts are limited to that task's grant
      And it cannot use another repository's writer through that session

    @bc-c8-002 @current
    Scenario: Execution outcome returns to the owning task
      Given an accepted task has started an agent session
      When the session completes or fails
      Then its outcome is reported to the same task identity
      And the execution boundary does not decide task admission or owner review

    @bc-c8-003 @current
    Scenario: A task can use a supported execution mode
      Given a task is eligible for host or isolated execution
      When its configured mode is selected
      Then the task has one inspectable execution outcome
      And changing the execution mode does not change the task's public answer contract
