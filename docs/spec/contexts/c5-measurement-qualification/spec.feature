# C5 owns measurement meaning and qualification, not promotion authority.
Feature: Measurement and qualification

  Rule: A verdict is attributable to an exact artifact and obligation set

    @bc-c5-001 @proposed
    Scenario: Measurements retain tool and source identity
      Given an artifact digest and versioned behavior obligations are pinned
      When a tool records a measurement
      Then the measurement names the tool, source, artifact, and obligation version
      And it remains distinguishable from a verdict or a release decision

    @bc-c5-002 @proposed
    Scenario: Missing evidence cannot qualify a change
      Given required measurements for a pinned artifact are incomplete or untrusted
      When qualification is derived
      Then the verdict is unjudged or failed
      And the artifact is not reported as qualified

    @bc-c5-003 @proposed
    Scenario: Complete trusted evidence may qualify a change
      Given all required measurements match the pinned artifact and oracle version
      And no veto has fired
      When qualification is derived
      Then a pass verdict names the evidence and version it used
      And the verdict does not itself select a candidate or authorize deployment
