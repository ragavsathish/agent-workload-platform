# C7 owns spec cuts, runs, candidates, and one selection decision.
Feature: Component regeneration

  Rule: A ratified cut fixes the obligations for one run

    @bc-c7-001 @proposed
    Scenario: A component cut is ratified only with a boundary and gate
      Given one repository, component, base revision, interface, and write authority are named
      When the component owner ratifies a behavior cut and independent gate
      Then the cut receives an immutable digest
      And later learning requires a new cut rather than changing that digest

    @bc-c7-002 @proposed
    Scenario: Generation waits for a proved clean-room fence
      Given a ratified cut and allowed inputs are pinned
      When the old implementation or private judging inputs remain reachable
      Then generation is held before candidates start

  Rule: Parallel candidates keep separate evidence and one promotion decision

    @bc-c7-003 @proposed
    Scenario: Candidates finish in any order without overwriting each other
      Given independent candidates share one pinned cut and distinct candidate identities
      When generation and measurements complete in any order
      Then each candidate retains its own artifact and evidence
      And an eligible set contains only candidates with complete matching evidence

    @bc-c7-004 @proposed
    Scenario: Competing selections cannot both claim promotion
      Given an eligible set and current target base revision
      When two reviewers attempt to select different candidates against one decision version
      Then at most one digest is selected
      And a stale or competing selection is refused
