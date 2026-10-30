# C2 component contract for the private Pi Durable owner transport.
Feature: Tasking owner client

  Rule: Commands use one authenticated private owner protocol

    @owner-client-001
    Scenario: A command carries a fresh transport identity and current bearer token
      Given the gateway has an owner endpoint and a token file
      When it sends a command to the private task endpoint
      Then the request is JSON over POST with a fresh transport identity
      And the current bearer token is read for that call
      And the response must be a successful owner envelope

    @owner-client-002
    Scenario: Submission preserves the caller's durable request identity
      Given the caller supplied a task kind, input, and stable request identity
      When the client submits work
      Then that identity is present at both owner protocol levels
      And the returned native task identity is reported unchanged

  Rule: Task observations and controls retain their protocol meaning

    @owner-client-003
    Scenario: Task queries forward their identity, cursor, and limit
      Given the caller requests one task, a batch, a product view, progress, or an owner list
      When the owner answers
      Then the client returns the owner's data without inventing task state
      And an empty batch makes no owner request

    @owner-client-004
    Scenario: Task controls forward the intended native identity
      Given a task is owned by the caller
      When the caller aborts, retries, or cancels product work
      Then the matching private command carries that task identity
      And an abort reports the owner's disposition

  Rule: Failure remains bounded and observable

    @owner-client-005
    Scenario: Transport failure does not expose private details
      Given the private owner is unreachable, times out, or returns an HTTP error
      When a command is attempted
      Then the caller receives a bounded unavailable error
      And telemetry records only the command and bounded failure kind

    @owner-client-006
    Scenario: Owner refusal remains distinguishable from transport failure
      Given the private owner answers with an unsuccessful envelope
      When the client reads that answer
      Then the owner refusal is raised to the caller
      And no transport failure is counted
