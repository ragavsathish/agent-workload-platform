workspace "Owner workday EventStorming wall" "Tentative outer loop across current day-to-day work and proposed AWP improvement selection." {
    model {
        owner = element "Owner" "Person" "Expresses needs, reviews outcomes, and chooses follow-up." "Actor"
        need = element "Need expressed or signal observed" "Entry event" "A question, work request, observation, or alert begins a pass." "Event"
        converse = element "Talk with Pi" "Current command" "Ask or instruct during a voice session." "Command"
        answer = element "Response delivered" "Current outcome" "The completed turn has an answer and diagnostics." "Event"
        workspace = element "Repository or scratch chosen" "Current task input" "Choose AWP, another configured repository, or scratch." "ReadModel"
        delegate = element "Submit delegated work" "Current command" "Submit agent-run with owner, selected workspace, instruction, and request ID." "Command"
        accepted = element "Task accepted" "Current pivotal event" "Pi Durable gives the request one task identity." "Pivotal"
        execute = element "Host tools or task VM started" "Current policy/outcome" "The accepted task uses the configured execution route." "Policy"
        result = element "Task result captured" "Current pivotal event" "Bounded result and artifact become queryable." "Pivotal"
        taskFailure = element "Task failed, aborted, or parked" "Current alternative" "The owner can inspect and choose a valid transition." "Event"
        knowledge = element "Journal and classification recorded" "Current parallel outcomes" "Separate durable tasks process a completed owner turn." "Event"
        reviewKnowledge = element "Knowledge reviewed or corrected" "Current owner decision" "Attributed entries receive a human review action." "Event"
        daily = element "Daily journal written" "Current outcome" "One day's messages are summarized by a separate durable task." "Event"
        lyrics = element "Lyric manifest prepared" "Current outcome" "A song-lyrics task yields a reviewable title, style, and text." "Event"
        lyricReview = element "Approve lyrics and request render" "Current owner decision" "The owner approves the full manifest before song-render." "Policy"
        song = element "Song artifact stored" "Current outcome" "The separate render task produces bounded audio." "Event"
        health = element "Health evidence observed" "Current read model" "Dashboards, traces, checks, and alerts are inspected." "ReadModel"
        investigation = element "Investigation finding captured" "Current outcome" "A selected alert can start a durable investigation." "Event"
        review = element "Owner reviewed outcome" "Current decision" "The owner sees the answer, artifact, finding, or failure." "Policy"
        followup = element "Follow-up requested or work closed" "Current outcome" "Continue the same task/session, start another, or stop." "Event"
        improve = element "AWP improvement selected" "Proposed policy" "Only an AWP-targeted change enters the separate production-change walk." "ProposedPolicy"
        regenerate = element "Component regeneration nominated" "Proposed policy" "One component in any selected repository enters its own clean-room walk." "ProposedPolicy"
        hotspot = element "Who may initiate work from evidence?" "Hot Spot" "Set authority, deduplication, and owner approval boundaries." "Hotspot"

        owner -> need "Expresses need or inspects signal"
        need -> converse "Conversational question"
        converse -> answer "Completes turn"
        answer -> knowledge "Starts independent journal and classification tasks"
        knowledge -> reviewKnowledge "Presents attributed entries"
        answer -> daily "May submit one day's messages separately"
        need -> workspace "Delegated work"
        workspace -> delegate "Names target workspace"
        delegate -> accepted "Admitted after validation and idempotency"
        accepted -> execute "Prepares workspace and execution route"
        execute -> result "Completes and captures artifact"
        execute -> taskFailure "Fails, aborts, or parks"
        taskFailure -> review "Makes failure visible"
        result -> review "Presents progress and result"
        need -> lyrics "Song request starts lyric task"
        lyrics -> lyricReview "Presents complete manifest"
        lyricReview -> song "Starts separate render task"
        song -> review "Presents playable artifact"
        need -> health "Operational question or alert"
        health -> investigation "Selected alert starts durable task"
        investigation -> review "Presents bounded finding"
        answer -> review "Presents conversation outcome"
        reviewKnowledge -> review "Presents reviewed knowledge"
        daily -> review "Presents daily account"
        review -> followup "Chooses next action"
        review -> improve "Evidence-linked change candidate only"
        review -> regenerate "Replaceable component selected"
        improve -> hotspot "Authority unresolved"
        regenerate -> hotspot "Authority unresolved"
    }
    views {
        custom owner-workday "Owner day-to-day EventStorming wall" "Current paths and a proposed improvement branch; arrows are process relationships, not a shared event bus." {
            include *
            autoLayout tb
        }
        styles {
            element "Actor" {
                shape Person
                background #0b4f83
                color #ffffff
                width 300
                height 110
            }
            element "Event" {
                shape RoundedBox
                background #ffd28a
                color #4b2d15
                stroke #dd8e2e
                width 330
                height 110
            }
            element "Pivotal" {
                shape RoundedBox
                background #ffe0a3
                color #4b2d15
                stroke #c7443f
                strokeWidth 5
                width 330
                height 110
            }
            element "Command" {
                shape RoundedBox
                background #dbeafe
                color #102a43
                stroke #2563eb
                width 330
                height 110
            }
            element "Policy" {
                shape RoundedBox
                background #e4dcf6
                color #402b64
                stroke #8c70bd
                width 330
                height 110
            }
            element "ReadModel" {
                shape RoundedBox
                background #d8efdc
                color #18452a
                stroke #4d9f65
                width 330
                height 110
            }
            element "ProposedPolicy" {
                shape RoundedBox
                background #efe8fa
                color #402b64
                stroke #8c70bd
                strokeWidth 4
                width 330
                height 110
            }
            element "Hotspot" {
                shape RoundedBox
                background #f8d4de
                color #662d43
                stroke #cc7890
                width 330
                height 110
            }
            relationship "Relationship" {
                color #94745c
                thickness 3
                fontSize 18
            }
        }
    }
}
