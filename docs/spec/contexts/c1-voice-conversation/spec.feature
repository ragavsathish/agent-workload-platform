# C1 owns the meaning of a session, turn, answer, and interruption.
Feature: Voice conversation

  Rule: A turn has an inspectable outcome

    @bc-c1-001 @current
    Scenario: A completed turn remains available to the owner
      Given an owner has an active conversation
      When a turn completes
      Then its answer and transcript are available in that conversation
      And the turn can be identified as a source for later work

    @bc-c1-002 @current
    Scenario: An interrupted turn does not masquerade as a complete answer
      Given an owner has an active conversation
      When the turn is interrupted before completion
      Then its interruption is visible
      And no complete answer is inferred from the partial turn

  Rule: A conversation may request work without owning its lifecycle

    @bc-c1-003 @current
    Scenario: A task request leaves the conversation boundary
      Given an owner asks for bounded work during a conversation
      When the request is submitted to Tasking
      Then the conversation retains the source turn
      And Tasking owns acceptance and subsequent task state
