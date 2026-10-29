# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Voice conversation
Feature: Inspect conversation diagnostics

  # Allure result: acd136af-4f59-43ab-88d9-dd9a7459fc20-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.explains a truncated replay while keeping its available evidence
  Scenario: explains a truncated replay while keeping its available evidence [acd136af]
    Given the diagnostics page is open
    When I load a recent conversation
    Then replay and input energy are available
    Then the replay warning names the lost chunks and duration limit

  # Allure result: 76096751-7801-4030-918b-f53c2e736914-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.keeps replay controls visible when metrics fail
  Scenario: keeps replay controls visible when metrics fail [76096751]
    Given the diagnostics page is open
    When I open the recorded session
    Then the missing metrics are explained without hiding audio replay

  # Allure result: 9f406119-d225-4a72-a0dc-ce30e31f9fa1-result.json
  # Validation layer: journey; source: voice.playwright.diagnostics.diagnostics.spec.ts.renders lightweight conversation diagnostics
  Scenario: renders lightweight conversation diagnostics [9f406119]
    Given the diagnostics page is open
    When I load a recent conversation
    Then replay and input energy are available
    And the lightweight page excludes Flutter and browser errors

  # Allure result: 4caca435-cdcc-42e1-9ea4-6cea118ba607-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.replay dashboard stays usable across mobile, tablet, and desktop
  Scenario: replay dashboard stays usable across mobile, tablet, and desktop [4caca435]
    Given the replay dashboard opens at mobile resolution
    Given the replay dashboard opens at tablet resolution
    Given the replay dashboard opens at desktop resolution
    Then the browser reports no unexpected errors

  # Allure result: 9d10f171-e9a4-492b-bc05-9d358ba5d459-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.replays a recorded conversation through the C2 Voice Edge mock
  Scenario: replays a recorded conversation through the C2 Voice Edge mock [9d10f171]
    Given the diagnostics page is open
    When I load a recent conversation
    Then replay and input energy are available
    And the mock records the exact C2 endpoints used by the browser

  # Allure result: e910bfb1-1f36-4369-a7ba-c90c5e7a053a-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.reports an unavailable replay list without showing stale sessions
  Scenario: reports an unavailable replay list without showing stale sessions [e910bfb1]
    Given the diagnostics page is open
    Then the failed Voice Edge request is visible and attributable

  # Allure result: abeb4c2d-0fc3-4673-a7e2-70761e25711c-result.json
  # Validation layer: integration; source: voice.playwright.diagnostics-c2-mock.diagnostics-c2-mock.spec.ts.shows the empty replay state without inventing a session
  Scenario: shows the empty replay state without inventing a session [abeb4c2d]
    Given the diagnostics page is open
    Then the page explains that no conversation has completed
