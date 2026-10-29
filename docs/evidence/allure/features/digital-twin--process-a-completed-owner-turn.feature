# Extracted from Allure run 2026-10-28T17-47-20-707Z-36590 at commit 2bd2486.
# Observed passed steps; no step definitions or executable binding are implied.
# Epic: Digital twin
Feature: Process a completed owner turn

  # Allure result: b472a31b-200e-430f-8ec6-65bcb711dcec-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-product-workflows.packages.tasking.tests.infrastructure.test_pi_durable_product_workflows#test_journal_and_classification_are_independent_native_tasks
  Scenario: test_journal_and_classification_are_independent_native_tasks [b472a31b]
    Given a completed owner turn is ready for durable learning
    When the Gateway sends it directly to Pi Durable
    Then journal extraction and assertion classification have separate durable task records

  # Allure result: 8e2c9cab-5f6d-4819-b315-9f10ea7133f3-result.json
  # Validation layer: integration; source: voice.pytest.pi-durable-product-workflows.packages.tasking.tests.infrastructure.test_pi_durable_product_workflows#test_product_failures_remain_queryable_in_pi_durable
  Scenario: test_product_failures_remain_queryable_in_pi_durable [8e2c9cab]
    Given the Pi Durable owner is accepting tasks with a worker failure outcome
    When one completed owner turn fans out to journal and classification
    Then both independently queryable Pi Durable tasks retain their failure
