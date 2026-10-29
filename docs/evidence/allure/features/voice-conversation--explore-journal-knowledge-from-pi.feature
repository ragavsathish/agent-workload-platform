# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Voice conversation
Feature: Explore journal knowledge from Pi

  # Allure result: 42dc1387-a4d4-4264-9318-bccfeb62ecb8-result.json
  # Validation layer: journey; source: voice.playwright.voice.voice.spec.ts.opens journal knowledge from Pi home and returns through the Pi logo
  Scenario: opens journal knowledge from Pi home and returns through the Pi logo [42dc1387]
    Given Pi home is open
    When I open Knowledge
    Then the journal knowledge page is visible
    When I select the Pi logo
    Then Pi home reopens
