# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Knowledge and review
Feature: Correct and review journal knowledge

  # Allure result: 1d28d46c-0f67-41cc-85a6-cd78f6e176cc-result.json
  # Validation layer: deployedIntegration; source: voice.playwright.knowledge-live.knowledge-live.spec.ts.corrects one test-owned journal entry through the deployed knowledge browser
  Scenario: corrects one test-owned journal entry through the deployed knowledge browser [1d28d46c]
    Given the deployed browser shows the isolated source turn
    When I correct its note and type through the owner route
    Then the deployed graph retains the correction after reload
    And the browser reports no unexpected errors

  # Allure result: 686a231c-23c8-4b27-a6c9-40e3e9a4d1b8-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-c2-mock.knowledge-c2-mock.spec.ts.journal and graph stay usable across mobile, tablet, and desktop
  Scenario: journal and graph stay usable across mobile, tablet, and desktop [686a231c]
    Given the journal opens at mobile resolution
    When I switch to the knowledge map at mobile resolution
    Given the journal opens at tablet resolution
    When I switch to the knowledge map at tablet resolution
    Given the journal opens at desktop resolution
    When I switch to the knowledge map at desktop resolution
    Then the browser reports no unexpected errors

  # Allure result: 4e0e0257-b679-442a-af97-db63360d7aee-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-c2-mock.knowledge-c2-mock.spec.ts.reviewed journal entry stays linked across the C2 mock boundaries
  Scenario: reviewed journal entry stays linked across the C2 mock boundaries [4e0e0257]
    Given the journal browser loads entries from the C2 Oxigraph mock
    When I correct that exact entry through the owner review form
    Then the corrected entry survives a fresh browser load
    And the browser reports no unexpected errors

  # Allure result: b2cfa387-a4b3-4af9-aef0-1d72850510bb-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-base.knowledge-base.spec.ts.saves a note correction, assertion review, and removal through the owner route
  Scenario: saves a note correction, assertion review, and removal through the owner route [b2cfa387]
    Given an owner journal note is open
    When I save a corrected note and topics
    Then the corrected note appears in details and map
    When I reject an unverified source assertion
    Then the assertion is excluded after reload
    When I remove the reviewed note
    Then the note no longer appears in the graph or journal
    And the browser reports no unexpected errors
