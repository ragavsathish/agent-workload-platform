# C6 owns an AWP improvement case and its evidence-linked decisions.
Feature: AWP change governance

  Rule: Reviewed evidence is needed before a change case begins

    @bc-c6-001 @proposed
    Scenario: The owner nominates a bounded change
      Given an owner has reviewed an answer, task outcome, or incident finding
      When the owner nominates one AWP improvement
      Then the change case records the source evidence and intended boundary
      And the source outcome is not rewritten as a change approval

    @bc-c6-002 @proposed
    Scenario: A change is held without qualification
      Given a change artifact has a pinned revision and diff
      When its measurement verdict is failed or unjudged
      Then the change case is held with that verdict
      And it does not request an AWP pull request

    @bc-c6-003 @proposed
    Scenario: A qualified revision is the one offered for review
      Given a change artifact has a pass verdict for one exact revision
      When the case requests repository review
      Then the requested pull request names that revision and its evidence
      And a later artifact cannot silently replace it
