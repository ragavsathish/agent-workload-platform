# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Knowledge and review
Feature: Explore journal knowledge

  # Allure result: ef2b3ee3-b237-4c80-a523-ff8c8c67d595-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-base.knowledge-base.spec.ts.browses, filters, and maps journal notes with synchronized details
  Scenario: browses, filters, and maps journal notes with synchronized details [ef2b3ee3]
    Given journal knowledge is loaded from Oxigraph
    When I filter notes by topic
    Then the active filter and matching notes are visible
    When I clear the filter and select a note
    Then the selected note details match the journal
    When I open and navigate the relationship map
    Then the map and journal stay synchronized
    When I switch theme and use a phone viewport
    Then the knowledge page remains readable without overflow
    And the browser reports no unexpected errors

  # Allure result: 22e29864-5626-44ab-b0a0-ad1d04704efc-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-base.knowledge-base.spec.ts.combines type and date filters and removes them independently
  Scenario: combines type and date filters and removes them independently [22e29864]
    Given journal knowledge is open
    When I combine type and date filters
    Then only matching notes remain
    When I remove each filter independently
    Then the full journal list returns
    And the browser reports no unexpected errors

  # Allure result: 6555e1a3-ece9-40db-9fb4-c4ac373a3812-result.json
  # Validation layer: integration; source: voice.playwright.knowledge-base.knowledge-base.spec.ts.maps Cytoscape node events to journal state
  Scenario: maps Cytoscape node events to journal state [6555e1a3]
    Given the knowledge relationship map is open
    When I select a note node
    Then the original journal note remains visible
    When I select a topic node
    Then the journal filters to that topic
    When I select a capture node
    Then the journal shows the linked capture
    And the browser reports no unexpected errors
