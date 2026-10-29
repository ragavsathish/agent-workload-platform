# C9 owns target repository PR review and release verification.
Feature: Repository delivery

  Rule: Review and release refer to one pinned revision

    @bc-c9-001 @current
    Scenario: Repository review decides a pull request
      Given a target repository pull request names an exact revision and checks
      When its authorized reviewer decides it
      Then approval or requested changes are recorded for that revision
      And approval alone is not reported as a verified deployment

    @bc-c9-002 @proposed
    Scenario: An AWP soundtrack is tied to the reviewed diff
      Given an AWP pull request has an exact reviewed diff
      When approved lyrics and playable audio are attached
      Then the soundtrack refers to that pull request revision
      And missing or failed audio remains held unless an authorized exception is recorded

    @bc-c9-003 @current
    Scenario: Deployment verification follows the approved revision
      Given a revision has been approved for deployment
      When the operator deploys and verifies it
      Then the verification outcome names the deployed revision and environment
      And a failure leads to an explicit recovery or held state

    @bc-c9-004 @proposed
    Scenario: Another repository retains its own delivery authority
      Given a selected component candidate targets a repository other than AWP
      When its maintainer opens a pull request
      Then that repository's reviewer and release rules decide the outcome
      And AWP-specific soundtrack rules are not silently imposed
