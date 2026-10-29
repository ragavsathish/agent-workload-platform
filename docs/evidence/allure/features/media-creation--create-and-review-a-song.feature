# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Media creation
Feature: Create and review a song

  # Allure result: 171b1485-001c-4d70-b749-242c241c7d9c-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-product-workflows.packages.tasking.tests.infrastructure.test_pi_durable_product_workflows#test_failed_song_lyrics_remain_in_pi_durable_and_cannot_render
  Scenario: test_failed_song_lyrics_remain_in_pi_durable_and_cannot_render [171b1485]
    Given the Pi Durable worker fails while writing lyrics
    When the owner reads the generation and requests rendering
    Then Pi Durable retains the lyric failure and no render task is created

  # Allure result: ee439e3f-9302-45f2-b1b1-cd54dd5febfb-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-product-workflows.packages.tasking.tests.infrastructure.test_pi_durable_product_workflows#test_song_lyrics_and_render_use_native_pi_durable_tasks
  Scenario: test_song_lyrics_and_render_use_native_pi_durable_tasks [ee439e3f]
    Given an authenticated owner asks for a song in an allowed workspace
    When lyrics are created and the owner requests rendering
    Then lyric and render work are separate native Pi Durable tasks with a reviewable manifest
