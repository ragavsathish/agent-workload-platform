# C2 owns Task Request, Agent Task, progress, result, and Song Generation.
Feature: Tasking

  Rule: One admitted owner request has one task identity

    @bc-c2-001 @current
    Scenario: An eligible bounded request is accepted
      Given an authenticated owner supplies an eligible workspace and bounded instruction
      When the request is admitted
      Then one native task identity is returned
      And the owner can inspect that task's progress and terminal result

    @bc-c2-002 @agreed
    Scenario: An uncertain submission retries with the same request identity
      Given a request may have committed but its response was lost
      When the owner retries the same canonical request with its stable request identity
      Then the existing task identity is returned
      And no second task is admitted

    @bc-c2-003 @current
    Scenario: A conflicting or ineligible request is refused
      Given a request identity is already bound to different input or the workspace is ineligible
      When that request is submitted
      Then admission is refused with a reason
      And no other owner's task or artifact is exposed

  Rule: Accepted work keeps its own outcome

    @bc-c2-004 @current
    Scenario: A failed task remains queryable
      Given a task has been accepted
      When execution fails or is aborted
      Then the terminal failure remains attached to that task identity
      And the task is not reported as completed

    @bc-c2-005 @current
    Scenario: Missing artifact is reported separately from task completion
      Given a task completed with an artifact reference
      When the referenced artifact cannot be retrieved
      Then the owner sees an explicit artifact lookup failure
      And the task's terminal completion is not rewritten

  Rule: Song rendering follows a reviewable lyric result

    @bc-c2-006 @current
    Scenario: Lyrics and audio are separate task outcomes
      Given an owner has requested a song
      When lyrics are prepared and the owner requests rendering
      Then lyric and render work have separate task identities
      And an incomplete or failed lyric result cannot start rendering
