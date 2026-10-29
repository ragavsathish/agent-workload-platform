Feature: Exercise the deployed voice path

  Rule: A synthetic voice request produces a fresh observable result

    @behavior-blackbox_voice-001
    Scenario: A synthetic utterance crosses the deployed edge
      Given a configured owner identity and a synthetic utterance
      And the required edge, gateway, and artifact dependencies are ready
      When the utterance is streamed through the deployed voice entry point
      Then the probe returns a payload-free result
      And no transcript or credential is printed by the orchestration

    @behavior-blackbox_voice-002
    Scenario: Full-path telemetry increases after the request
      Given the full end-to-end mode is selected
      And operation counters are sampled before the voice request
      When the synthetic utterance completes
      Then the voice, inference, Pi turn, and task-submission counters increase
      And lifecycle metrics exist for the participating services

    @behavior-blackbox_voice-003
    Scenario: A requested remote-session proof is fresh
      Given remote-session verification is requested
      And attachment and conversation counters are sampled before the request
      When the voice request performs the remote-session path
      Then both counters increase relative to their samples

    @behavior-blackbox_voice-004
    Scenario: An unauthenticated tailnet uses the local test route
      Given the tailnet sidecar is not authenticated
      When the synthetic voice test starts its dependencies
      Then it uses the local test route for the probe
      And the probe still enters through the deployed voice edge
