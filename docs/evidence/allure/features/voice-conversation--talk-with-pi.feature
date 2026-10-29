# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Voice conversation
Feature: Talk with Pi

  # Allure result: 97b32206-c43c-4b25-9065-136dc038acc4-result.json
  # Validation layer: integration; source: voice.playwright.flutter-responsive-c2-mock.flutter-responsive-c2-mock.spec.ts.Flutter voice home, conversation, and task dialog fit mobile, tablet, and desktop
  Scenario: Flutter voice home, conversation, and task dialog fit mobile, tablet, and desktop [97b32206]
    Given Flutter voice home opens at mobile resolution
    When I open the Flutter conversation at mobile resolution
    Then the task creation dialog fits mobile resolution
    Given Flutter voice home opens at tablet resolution
    When I open the Flutter conversation at tablet resolution
    Then the task creation dialog fits tablet resolution
    Given Flutter voice home opens at desktop resolution
    When I open the Flutter conversation at desktop resolution
    Then the task creation dialog fits desktop resolution
    And the browser reports no unexpected errors

  # Allure result: 5d61f1b7-d1b5-488e-8761-327c6f5b07d0-result.json
  # Validation layer: journey; source: voice.playwright.voice-telemetry.voice.spec.ts.completes a deployed voice session and retains its diagnostics
  Scenario: completes a deployed voice session and retains its diagnostics [5d61f1b7]
    Given the deployed Flutter client is open
    When I start a conversation and mute during the response
    Then the completed transcript turn is visible
    And remote audio playback and microphone diagnostics are live
    When I end the conversation
    Then the voice session retains a replay and metrics
    And the same turn has a Tempo trace and an OTel metric increment
    And the browser reports no unexpected errors

  # Allure result: 613bd9ba-8313-4817-a461-f7e7b8bcb3cb-result.json
  # Validation layer: journey; source: voice.playwright.voice.voice.spec.ts.completes a deployed voice session and retains its diagnostics
  Scenario: completes a deployed voice session and retains its diagnostics [613bd9ba]
    Given the deployed Flutter client is open
    When I start a conversation and mute during the response
    Then the completed transcript turn is visible
    And remote audio playback and microphone diagnostics are live
    When I end the conversation
    Then the voice session retains a replay and metrics
    And the browser reports no unexpected errors

  # Allure result: 6907ea95-74f4-4881-97e9-d6d1de0458ef-result.json
  # Validation layer: journey; source: voice.playwright.voice.voice.spec.ts.keeps the primary voice controls usable on a phone viewport
  Scenario: keeps the primary voice controls usable on a phone viewport [6907ea95]
    Given the voice home is open on a phone viewport
    Then primary controls are visible and have usable touch targets
    Then the page fits the viewport without horizontal overflow
    And the browser reports no unexpected errors
