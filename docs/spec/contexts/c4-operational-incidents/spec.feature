# C4 owns managed alert identity, incident epoch, and investigation finding.
Feature: Operational incidents

  Rule: A firing alert starts at most one investigation per incident epoch

    @bc-c4-001 @current
    Scenario: An eligible firing alert opens a bounded investigation
      Given a managed alert is firing with an incident fingerprint and epoch
      When the monitor submits its investigation request
      Then one bounded task is associated with that incident epoch
      And the alert evidence remains attributable to the task

    @bc-c4-002 @current
    Scenario: Duplicate polling does not create another investigation
      Given an investigation already exists for a managed alert's current epoch
      When the same firing alert is observed again
      Then the existing investigation is retained
      And no second task is created for that epoch

    @bc-c4-003 @current
    Scenario: An unavailable investigation remains an operator concern
      Given a managed alert is firing
      When its investigation fails or cannot be judged
      Then the alert remains visible for operator review
      And no product change is inferred from the alert alone
