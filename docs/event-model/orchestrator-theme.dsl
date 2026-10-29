workspace "Voice Agent orchestrates AWP evolution" "A synthesis of current product flows and a proposed, gated AWP improvement loop; not a claim of autonomous production mutation." {
    model {
        voice = element "Voice interaction" "Current" "A persistent Pi conversation receives a spoken request or completes a turn." "Current"
        accepted = element "Durable task accepted" "Current" "The Pi Durable Owner records one task identity and state." "Current"
        piTask = element "Pi task session" "Current, selected kinds" "Agent-run and song-lyrics use a native Pi conversation." "Current"
        effect = element "Product effect runs" "Current, selected kinds" "Journal, classification, daily journal, and song rendering use bounded host child processes." "Current"
        builder = element "Image handoff prepared" "Current, conditional" "A shared builder workflow prepares and verifies a repository image after a cache miss." "Current"
        image = element "Execution image resolved" "Current, conditional" "Use a default image, verified cache hit, or a builder handoff after a cache miss." "Current"
        sandbox = element "Agent Session tools run" "Current" "Host tools or a per-task Gondolin VM act on a prepared workspace." "Current"
        result = element "Task result checkpointed" "Current" "The owner stores a bounded result; agent work can include a workspace artifact." "Current"
        knowledge = element "Knowledge extracted" "Current" "A completed owner turn starts separate journal and classification tasks." "Current"
        reviewed = element "Knowledge reviewed" "Current" "The owner corrects or reviews attributed knowledge through the Gateway." "Current"
        telemetry = element "Behavior measured" "Current" "Tests, Allure results, metrics, traces, and alerts record evidence." "Current"
        incident = element "Investigation task accepted" "Current" "Selected firing stack alerts submit a Pi Durable investigation task." "Current"
        candidate = element "Improvement candidate chosen" "Proposed decision" "A person or governed policy connects evidence to a specific change request." "Proposed"
        change = element "Change task accepted" "Proposed decision" "A bounded improvement request enters the same durable task contract." "Proposed"
        source = element "AWP source changed" "Proposed outcome" "An authorized improvement task changes the AWP repository in its isolated workspace." "Proposed"
        verified = element "Change qualified" "Proposed gate" "Relevant behavior checks and measurements are compared with an explicit baseline." "Proposed"
        pr = element "AWP PR opened" "Proposed loop step" "A reviewable PR contains the qualified AWP diff and engineering summary." "Proposed"
        lyrics = element "Diff lyrics reviewed" "Current song capability" "The lyric Pi task receives a brief grounded in the reviewed diff; the owner reviews its full manifest." "Current"
        song = element "Song rendered" "Current song capability" "A separate render task uses the approved manifest and stores a bounded M4A artifact." "Current"
        soundtrack = element "PR includes lyrics and song" "Proposed loop step" "The PR body includes complete lyrics and a reviewer-accessible, commit-pinned song link." "Proposed"
        approved = element "Release approved" "Proposed gate" "A reviewed and qualified change receives a release decision." "Proposed"
        deployed = element "AWP deployment converged" "Current" "The operator workflow applies the selected AWP stack revision and verifies readiness." "Current"

        voice -> accepted "Delegates work or completed-turn jobs"
        accepted -> piTask "Agent-run or song-lyrics"
        accepted -> effect "Journal, classify, daily journal, song-render"
        piTask -> image "Resolves image for VM mode"
        piTask -> builder "Repository cache miss"
        builder -> image "Verified handoff"
        image -> sandbox "Supplies task VM when selected"
        piTask -> sandbox "Starts host or VM tools"
        sandbox -> result "Captures work"
        effect -> result "Checkpoints kind-specific result"
        effect -> knowledge "Journal and classification output"
        knowledge -> reviewed "Presents attributed entry"
        result -> telemetry "Emits task evidence"
        telemetry -> incident "Firing managed alert submits task"
        incident -> sandbox "Investigates through same owner"
        reviewed -> candidate "May inform improvement" "" "Proposed"
        telemetry -> candidate "May inform improvement" "" "Proposed"
        candidate -> change "Requests bounded change" "" "Proposed"
        change -> accepted "Uses durable task contract" "" "Proposed"
        sandbox -> source "Edits AWP when change task is authorized" "" "Proposed"
        source -> verified "Evaluates AWP change" "" "Proposed"
        verified -> pr "Opens engineering review" "" "Proposed"
        pr -> lyrics "Grounds lyric brief in PR diff" "" "Proposed"
        lyrics -> song "Owner approves manifest before render"
        song -> soundtrack "Publishes reviewed audio and full lyrics" "" "Proposed"
        soundtrack -> approved "Passes PR review and release gate" "" "Proposed"
        approved -> deployed "Requests deployment" "" "Proposed"
        deployed -> telemetry "Emits verification and runtime evidence"
        deployed -> voice "Changes future experience"
    }
    views {
        custom operating-loop "Voice Agent orchestrates AWP evolution" "Blue paths are current behavior; purple paths are proposed, gated AWP change links." {
            include *
            autoLayout tb
        }
        styles {
            element "Current" {
                shape RoundedBox
                background #dbeafe
                color #102a43
                stroke #2563eb
                width 330
                height 120
                fontSize 25
            }
            element "Proposed" {
                shape RoundedBox
                background #e4dcf6
                color #402b64
                stroke #8c70bd
                width 330
                height 120
                fontSize 25
            }
            relationship "Relationship" {
                color #3d6179
                thickness 3
                fontSize 20
            }
            relationship "Proposed" {
                color #8c70bd
                style Dashed
                thickness 3
                fontSize 20
            }
        }
    }
}
