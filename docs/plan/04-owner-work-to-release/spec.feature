# Slice wrapper: journeys and handoffs only. Local rules live in docs/spec/contexts.
# Each Contracts line is checked against stable context scenario IDs.
Feature: Owner work reaches a reviewable outcome

  @slice-04-001 @current
  Scenario: A conversation delegates work and returns an inspectable result
    # Contracts: @bc-c1-001 @bc-c1-003 @bc-c2-001 @bc-c2-004 @bc-c2-005 @bc-c8-001 @bc-c8-002
    Given an owner has a conversation and requests bounded work
    When Voice Conversation passes the request identity and workspace to Tasking
    And Tasking starts an Agent Execution session for the accepted task
    Then the owner can review the task result or retained failure under the same task identity
    And any missing artifact is reported without changing that terminal result

  @slice-04-002 @current
  Scenario: A completed turn yields reviewable personal knowledge
    # Contracts: @bc-c1-001 @bc-c3-001 @bc-c3-002 @bc-c3-003 @bc-c2-001
    Given a completed owner turn has a stable source identity
    When Personal Knowledge receives attributed suggestions and a daily-account request
    Then the owner can review the suggestions against that source
    And the daily account names the source set it used
    And the conversation answer remains independent of either background outcome

  @slice-04-003 @current
  Scenario: An alert leads to one bounded investigation and owner review
    # Contracts: @bc-c4-001 @bc-c4-002 @bc-c4-003 @bc-c2-001 @bc-c2-004
    Given a managed alert fires in one incident epoch
    When Operational Incidents asks Tasking for an investigation
    Then repeated observations retain one investigation task for that epoch
    And its finding or failure is available for owner review
    And the alert alone does not authorize a product change

  @slice-04-004 @proposed
  Scenario: A reviewed outcome becomes a qualified AWP change and verified release
    # Contracts: @bc-c6-001 @bc-c6-002 @bc-c6-003 @bc-c5-001 @bc-c5-002 @bc-c5-003 @bc-c2-006 @bc-c9-001 @bc-c9-002 @bc-c9-003
    Given an owner nominates one AWP improvement from reviewed evidence
    When a change task supplies a pinned diff and independent measurements qualify it
    And the maintainer opens a pull request with a soundtrack tied to that diff
    Then repository review decides the exact revision
    And deployment verification reports a separate outcome for that revision
    And missing or unjudged evidence holds the change before release

  @slice-04-005 @proposed
  Scenario: A ratified component cut yields one selected candidate for its target repository
    # Contracts: @bc-c7-001 @bc-c7-002 @bc-c7-003 @bc-c7-004 @bc-c8-001 @bc-c5-001 @bc-c5-002 @bc-c5-003 @bc-c9-001 @bc-c9-003 @bc-c9-004
    Given a component owner ratifies a cut for one repository and base revision
    When isolated candidates are generated and independently measured against that cut
    And an authorized reviewer selects one eligible digest
    Then only that digest enters the target repository's review path
    And an AWP target follows AWP delivery while another repository retains its own rules
    And release verification remains distinct from candidate eligibility
