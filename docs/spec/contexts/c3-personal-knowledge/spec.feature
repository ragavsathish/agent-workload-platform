# C3 owns candidate knowledge, review history, and the daily account.
Feature: Personal knowledge

  Rule: Source evidence precedes accepted knowledge

    @bc-c3-001 @current
    Scenario: A completed turn produces attributed suggestions
      Given a completed owner turn has a stable source identity
      When knowledge extraction produces a suggestion
      Then the suggestion names its source
      And it remains reviewable rather than silently accepted

    @bc-c3-002 @current
    Scenario: Owner review changes current interpretation
      Given a suggestion and its source are available
      When the owner accepts, corrects, or rejects it
      Then the chosen review action is recorded
      And the current interpretation reflects that action
      And earlier source and review history remain attributable

  Rule: A daily account names the evidence it used

    @bc-c3-003 @current
    Scenario: A daily account is scoped to owner and source set
      Given an owner, local date, time zone, and bounded source set are known
      When a daily account is written
      Then the account identifies the source set it summarizes
      And another source set is not silently substituted for that account
