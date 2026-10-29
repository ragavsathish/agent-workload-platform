Feature: Run deployed browser journeys with bounded evidence

  Rule: A browser run has valid inputs and cleans up its bridge

    @behavior-playwright_e2e-001
    Scenario: An unsupported browser project is refused
      Given the requested project is not in the supported project list
      When a browser run is requested
      Then the run fails before starting a browser bridge

    @behavior-playwright_e2e-002
    Scenario: A missing recorded voice fixture is refused
      Given the recorded voice fixture is missing or empty
      When a browser run is prepared
      Then preparation fails before a browser test starts

    @behavior-playwright_e2e-003
    Scenario: A voice journey receives a trace and prepared audio
      Given the voice browser project is selected
      And a nonempty recorded voice fixture is present
      When its browser inputs are prepared
      Then the browser receives a temporary audio fixture
      And the voice project receives a fresh trace identifier

    @behavior-playwright_e2e-004
    Scenario: A native durable journey has an owner and unique task
      Given the native durable browser project is selected
      And an owner identity is provided
      When a unique scratch task is submitted
      Then its task identifier and proof marker are passed to the browser journey
      And an absent owner identity stops the submission

    @behavior-playwright_e2e-005
    Scenario: Browser support resources are removed after the run
      Given the browser bridge was started
      When the selected browser journey succeeds or fails
      Then the bridge is removed
      And generated audio is removed when the selected journey used it
      And browser evidence remains in a private artifact directory
