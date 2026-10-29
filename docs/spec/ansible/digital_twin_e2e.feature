Feature: Verify digital-twin RDF deployment

  @behavior-digital_twin_e2e-001
  Scenario: A valid fixture can be stored and queried
    Given the digital-twin fixture satisfies its declared RDF shapes and vocabularies
    When its graphs are loaded under a unique test namespace
    Then a query over that namespace returns more than zero triples

  @behavior-digital_twin_e2e-002
  Scenario: Test graphs are removed after the run
    Given the test namespace was prepared
    When verification succeeds or fails
    Then every graph in that namespace is removed
    And unrelated graphs are left outside the test operation
