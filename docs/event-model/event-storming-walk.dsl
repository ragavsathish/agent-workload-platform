workspace "AWP evolution EventStorming walk" "One desk-derived process walk; current outcomes and proposed change gates are distinguished." {
    model {
        owner = element "AWP owner" "Person" "Requests, reviews, and releases changes." "Actor"
        turn = element "Voice turn completed" "Current candidate event" "An owner turn ended." "Event"
        knowledge = element "Knowledge recorded" "Current candidate event" "Journal and classification tasks recorded attributed output." "Event"
        reviewed = element "Knowledge reviewed" "Current candidate event" "The owner accepted or corrected attributed knowledge." "Event"
        evidence = element "Behavior evidence" "Read model" "Allure, oracle status, metrics, traces, alerts, and task results available to the decider." "ReadModel"
        candidate = element "Select AWP improvement" "Proposed policy" "Choose a bounded, evidence-linked change request." "ProposedPolicy"
        submit = element "Submit change task" "Command" "The owner or governed policy requests an AWP repository task." "Command"
        accepted = element "Task accepted" "Current pivotal event" "Pi Durable records one task identity and owner." "Pivotal"
        prepared = element "AWP workspace prepared" "Current candidate event" "The selected repository revision is materialized for the task." "Event"
        mode = element "Resolve task execution" "Policy" "Select host or Gondolin mode; VM mode resolves an execution image." "Policy"
        handoff = element "Image handoff prepared" "Conditional event" "A cache miss was built and verified by the shared builder." "Event"
        vm = element "Task VM started" "Current pivotal event" "Gondolin starts an isolated Agent Session with /workspace mounted." "Pivotal"
        host = element "Host tools started" "Current alternative event" "The same task contract uses host coding tools when host mode is selected." "Event"
        changed = element "AWP source changed" "Proposed outcome" "The authorized improvement task changed its AWP workspace." "ProposedEvent"
        result = element "Task result captured" "Current pivotal event" "The owner checkpointed a bounded result and artifact." "Pivotal"
        failed = element "Task failed" "Current alternative event" "The owner retained a queryable failure without a successful result." "Event"
        qualify = element "Qualify changed behavior" "Proposed policy" "Compare trusted measurements with the accepted baseline." "ProposedPolicy"
        qualified = element "AWP change qualified" "Proposed outcome" "Relevant checks passed the chosen gate." "ProposedEvent"
        held = element "AWP change held" "Proposed alternative outcome" "The change stopped before PR or release when qualification failed or was unjudged." "ProposedEvent"
        pr = element "AWP PR opened" "Proposed loop outcome" "A reviewable diff, engineering summary, and checks were published." "ProposedEvent"
        lyricTask = element "Lyric task accepted" "Current capability" "A diff-grounded brief entered Pi Durable as song-lyrics." "Event"
        lyrics = element "Lyric manifest prepared" "Current candidate event" "Title, style, and complete lyrics became reviewable." "Event"
        lyricReview = element "Approve complete lyrics" "Human policy" "The owner checks the full manifest before rendering." "Policy"
        renderTask = element "Render task accepted" "Current capability" "A separate song-render task received the approved manifest." "Event"
        song = element "Song artifact stored" "Current candidate event" "The bounded M4A became available through the owner route." "Event"
        prUpdated = element "PR soundtrack published" "Proposed loop outcome" "The PR includes complete lyrics and a reviewer-accessible song link." "ProposedEvent"
        release = element "Approve AWP release" "Proposed policy" "Review the PR, evidence, and rollback decision." "ProposedPolicy"
        deployed = element "AWP deployment converged" "Current pivotal event" "The operator workflow applied the chosen stack revision." "Pivotal"
        verified = element "Verification verdict recorded" "Current candidate event" "Deployment checks produced pass, fail, or unjudged evidence." "Event"
        alert = element "Investigation task accepted" "Current alternative event" "A selected firing stack alert created a Pi Durable investigation task." "Event"
        investigated = element "Investigation result captured" "Current candidate event" "The alert investigation produced a bounded result." "Event"
        h1 = element "H1 · Who selects a change?" "Hot Spot" "Define evidence threshold, authority, and deduplication." "Hotspot"
        h2 = element "H2 · What qualifies it?" "Hot Spot" "Define oracle coverage, baseline, and vetoes." "Hotspot"
        h3 = element "H3 · PR soundtrack gate?" "Hot Spot" "Define diff capture, lyric approval record, and playable-link check." "Hotspot"

        owner -> turn "Completes spoken turn"
        turn -> knowledge "Parallel journal and classification tasks"
        owner -> reviewed "Reviews attributed entry"
        knowledge -> reviewed "Presents entry"
        reviewed -> candidate "May inform improvement"
        evidence -> candidate "May inform improvement"
        candidate -> h1 "Clarify"
        candidate -> submit "Requests bounded change"
        owner -> submit "Authorizes request"
        submit -> accepted "Pi Durable admits task"
        accepted -> prepared "Materialize repository"
        prepared -> mode "Select tool route"
        mode -> handoff "Repository image cache miss only"
        handoff -> vm "Register verified image"
        mode -> vm "Default image or cache hit"
        mode -> host "Host mode"
        vm -> changed "Run AWP coding tools"
        host -> changed "Run AWP coding tools"
        vm -> failed "Execution failure"
        host -> failed "Execution failure"
        failed -> evidence "Retain failure finding"
        changed -> result "Capture workspace result"
        result -> qualify "Compare change evidence"
        qualify -> h2 "Clarify"
        qualify -> qualified "Passes chosen gate"
        qualify -> held "Fails or cannot be judged"
        held -> evidence "Retain qualification finding"
        qualified -> pr "Open engineering review"
        pr -> lyricTask "Submit brief grounded in PR diff"
        lyricTask -> lyrics "Pi prepares manifest"
        lyrics -> lyricReview "Present full manifest"
        owner -> lyricReview "Approves after review"
        lyricReview -> renderTask "Submit approved manifest"
        renderTask -> song "Host render and store"
        song -> prUpdated "Publish lyrics and M4A link"
        prUpdated -> h3 "Clarify"
        prUpdated -> release "Request release decision"
        owner -> release "Approves reviewed PR"
        release -> deployed "Deploy chosen revision"
        deployed -> verified "Run verification"
        verified -> evidence "Add verdict and measurements"
        evidence -> alert "Managed alert fires"
        alert -> investigated "Run durable investigation"
        investigated -> evidence "Add bounded finding"
    }
    views {
        custom coherent-walk "AWP · one EventStorming walk" "Orange: current candidate events · outlined orange: proposed outcomes · blue: commands · lilac: policies · green: evidence · pink: hotspots" {
            include *
            autoLayout tb
        }
        styles {
            element "Actor" {
                shape Person
                background #0b4f83
                color #ffffff
                width 260
                height 110
                fontSize 24
            }
            element "Event" {
                shape RoundedBox
                background #ffd28a
                color #4b2d15
                stroke #dd8e2e
                width 300
                height 110
                fontSize 23
            }
            element "Pivotal" {
                shape RoundedBox
                background #ffe0a3
                color #4b2d15
                stroke #c7443f
                strokeWidth 5
                width 300
                height 110
                fontSize 23
            }
            element "ProposedEvent" {
                shape RoundedBox
                background #ffead0
                color #4b2d15
                stroke #8c70bd
                strokeWidth 4
                width 300
                height 110
                fontSize 23
            }
            element "Command" {
                shape RoundedBox
                background #dbeafe
                color #102a43
                stroke #2563eb
                width 300
                height 110
                fontSize 23
            }
            element "Policy" {
                shape RoundedBox
                background #e4dcf6
                color #402b64
                stroke #8c70bd
                width 300
                height 110
                fontSize 23
            }
            element "ProposedPolicy" {
                shape RoundedBox
                background #efe8fa
                color #402b64
                stroke #8c70bd
                strokeWidth 4
                width 300
                height 110
                fontSize 23
            }
            element "ReadModel" {
                shape RoundedBox
                background #d8efdc
                color #18452a
                stroke #4d9f65
                width 300
                height 110
                fontSize 23
            }
            element "Hotspot" {
                shape RoundedBox
                background #f8d4de
                color #662d43
                stroke #cc7890
                width 300
                height 110
                fontSize 23
            }
            relationship "Relationship" {
                color #94745c
                thickness 3
                fontSize 18
            }
        }
    }
}
