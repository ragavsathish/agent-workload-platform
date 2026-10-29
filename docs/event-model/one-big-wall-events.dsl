workspace "One owner EventStorming Big Picture" "Tentative business-event timeline for daily work, AWP changes, and component regeneration." {
    model {
        // Main wall: past-tense outcomes, pivotal events, and unresolved hot spots only.
        need = element "Need expressed or signal noticed" "Entry event" "Owner request or operational observation." "Pivotal"
        turn = element "Voice turn completed" "Current event" "A conversational answer became available." "Event"
        turnInterrupted = element "Voice turn interrupted" "Current alternative" "No complete answer became available." "Event"
        taskRequested = element "Task requested" "Current event" "A workspace and bounded instruction were submitted." "Event"
        taskAccepted = element "Task accepted" "Current pivotal event" "Pi Durable assigned a task identity." "Pivotal"
        taskRefused = element "Task request refused" "Current alternative" "Invalid input, authorization, or workspace prevented acceptance." "Event"
        result = element "Task result captured" "Current event" "A bounded answer or artifact became available." "Event"
        taskFailed = element "Task failure retained" "Current alternative" "A failed, aborted, or parked attempt remained inspectable." "Event"
        knowledge = element "Knowledge suggestion recorded" "Current parallel event" "Journal or classification produced attributed material." "Event"
        knowledgeReviewed = element "Knowledge accepted, corrected, or rejected" "Current event" "Owner review determined its status." "Event"
        daily = element "Daily account written" "Current parallel event" "A separate durable task summarized one day." "Event"
        songRequested = element "Song requested" "Current event" "A creative request supplied a brief." "Event"
        lyrics = element "Lyrics prepared" "Current event" "The manifest became available for review." "Event"
        lyricApproved = element "Lyrics approved" "Current event" "The manifest was accepted for rendering." "Event"
        lyricsHeld = element "Lyrics rejected or unavailable" "Current alternative" "The brief may be revised or ended." "Event"
        song = element "Song stored" "Current event" "Audio became available." "Event"
        songFailed = element "Song render failed" "Current alternative" "Failure remained visible for retry or revision." "Event"
        alert = element "Alert fired" "Current event" "A monitored condition selected for investigation occurred." "Event"
        finding = element "Investigation finding captured" "Current event" "A bounded Pi Durable investigation supplied evidence." "Event"
        investigationFailed = element "Investigation failed or unjudged" "Current alternative" "The alert still needs operator review." "Event"
        reviewed = element "Outcome reviewed" "Current pivotal event" "The owner inspected the answer, artifact, failure, song, or finding." "Pivotal"
        closed = element "Work closed" "Current end" "No further work was chosen in this pass." "Event"
        followup = element "Follow-up requested" "Current continuation" "The task/session continued or a new task was submitted." "Event"

        awpNominated = element "AWP change nominated" "Proposed event" "Reviewed evidence justified one product improvement." "ProposedEvent"
        awpAccepted = element "AWP change task accepted" "Proposed event" "AWP workspace and task identity were pinned." "ProposedEvent"
        awpArtifact = element "AWP change artifact captured" "Proposed event" "A coding sandbox produced a bounded diff." "ProposedEvent"
        awpQualified = element "AWP change qualified" "Proposed event" "Trusted behavior measurements passed." "ProposedEvent"
        awpHeld = element "AWP change held" "Proposed end" "Task or qualification failed or remained unjudged." "ProposedEvent"
        awpPr = element "AWP PR opened" "Proposed event" "Diff, checks, and evidence became reviewable." "ProposedEvent"
        prLyrics = element "PR lyrics prepared" "Proposed event" "The lyric generator used the PR diff and produced a manifest." "ProposedEvent"
        prLyricsApproved = element "PR lyrics approved" "Proposed event" "A reviewer accepted the complete lyric manifest." "ProposedEvent"
        prSong = element "PR song rendered" "Proposed event" "Audio for the approved manifest became available." "ProposedEvent"
        soundtrack = element "PR soundtrack attached" "Proposed event" "Approved lyrics and rendered song were attached." "ProposedEvent"
        soundtrackHeld = element "PR soundtrack held" "Proposed alternative" "Lyrics, approval, or rendering did not complete." "ProposedEvent"
        awpApproved = element "AWP PR approved" "Proposed event" "Repository review passed." "ProposedEvent"
        awpRejected = element "AWP PR changes requested" "Proposed end" "Review returned the change for revision." "ProposedEvent"
        deployed = element "AWP deployment verified" "Proposed pivotal event" "The selected revision passed post-deploy checks." "ProposedPivotal"
        deployFailed = element "AWP deployment failed verification" "Proposed alternative" "Recovery or rollback was required." "ProposedEvent"
        recovered = element "AWP deployment recovered or rolled back" "Proposed end" "The operator restored a known service state." "ProposedEvent"

        nominated = element "Component nominated" "Proposed event" "One repository, component, base revision, and reason were named." "ProposedEvent"
        boundary = element "Component boundary accepted" "Proposed event" "Interface and write authority were agreed." "ProposedEvent"
        boundaryHeld = element "Component boundary held" "Proposed end" "Ownership or deletability remained unresolved." "ProposedEvent"
        cut = element "Spec cut ratified" "Proposed pivotal event" "Behavior, constraints, provenance, and gate were pinned." "ProposedPivotal"
        cutHeld = element "Spec cut held" "Proposed end" "Obligations were contradictory or lacked authority." "ProposedEvent"
        fence = element "Clean room verified" "Proposed event" "Old implementation and private judging inputs were inaccessible." "ProposedEvent"
        fenceFailed = element "Regeneration held before generation" "Proposed end" "The clean-room fence could not be proved." "ProposedEvent"
        candidates = element "Independent candidates generated" "Proposed parallel events" "Each candidate retained its identity and digest; arrival order is free." "ProposedEvent"
        generationFailed = element "Candidate generation failed" "Proposed alternative" "The failed attempt remained attributable to its candidate ID." "ProposedEvent"
        measured = element "Candidate measurements recorded" "Proposed event" "An independent gate measured each candidate against the same cut." "ProposedEvent"
        candidateHeld = element "Candidate held or unjudged" "Proposed end" "A required check failed, was missing, or was untrusted." "ProposedEvent"
        eligible = element "Eligible candidate set established" "Proposed event" "Evidence was joined by cut, boundary, and candidate identity." "ProposedEvent"
        selected = element "One candidate selected" "Proposed pivotal event" "An authorized reviewer chose one digest against the current base." "ProposedPivotal"
        selectionRefused = element "Candidate selection refused" "Proposed end" "No eligible candidate, stale base, or competing selection blocked promotion." "ProposedEvent"
        otherPr = element "Other repository PR opened" "Proposed event" "The target repository received source and evidence." "ProposedEvent"
        otherApproved = element "Other repository PR approved" "Proposed event" "That repository's review rule passed." "ProposedEvent"
        otherRejected = element "Other repository PR changes requested" "Proposed end" "The reviewer returned the change for revision." "ProposedEvent"
        promoted = element "Component release verified" "Proposed end" "The target repository's release rule completed." "ProposedEvent"
        releaseFailed = element "Component release held" "Proposed end" "Release failed or verification was inconclusive." "ProposedEvent"
        learning = element "Spec learning recorded" "Proposed event" "An owner-reviewed finding could inform a later cut." "ProposedEvent"

        hAuthority = element "H1 · Who may start product changes?" "Hot spot" "Alert investigation may start automatically; product-change authority is unresolved." "Hotspot"
        hBoundary = element "H2 · Is this component replaceable?" "Hot spot" "Check versioned interface, exclusive writes, and independent gate." "Hotspot"
        hSelection = element "H3 · Who selects a candidate?" "Hot spot" "Decision rights and concurrency may differ by repository." "Hotspot"
        hSoundtrack = element "H4 · Does soundtrack failure block review?" "Hot spot" "The PR workflow needs an explicit exception rule." "Hotspot"
        prHeld = element "AWP PR held for soundtrack" "Proposed alternative" "Review waited for a complete soundtrack or an authorized exception." "ProposedEvent"

        need -> turn "Conversation"
        need -> taskRequested "Delegated work"
        need -> songRequested "Creative request"
        turn -> turnInterrupted "Interrupted"
        turn -> reviewed "Answer inspected"
        turn -> knowledge "Independent background work"
        turn -> daily "Separate daily task"
        turnInterrupted -> reviewed "Interruption inspected"
        taskRequested -> taskAccepted "Accepted"
        taskRequested -> taskRefused "Refused"
        taskAccepted -> result "Completed"
        taskAccepted -> taskFailed "Failed or aborted"
        taskRefused -> reviewed "Refusal inspected"
        result -> reviewed "Artifact inspected"
        taskFailed -> reviewed "Failure inspected"
        knowledge -> knowledgeReviewed "Owner reviewed"
        knowledgeReviewed -> reviewed "Status inspected"
        daily -> reviewed "Daily account inspected"
        songRequested -> lyrics "Manifest prepared"
        lyrics -> lyricApproved "Accepted"
        lyrics -> lyricsHeld "Rejected or unavailable"
        lyricApproved -> song "Rendered"
        lyricApproved -> songFailed "Render failed"
        lyricsHeld -> reviewed "Lyrics outcome inspected"
        song -> reviewed "Audio inspected"
        songFailed -> reviewed "Failure inspected"
        alert -> finding "Investigation completed"
        alert -> investigationFailed "Investigation unavailable"
        finding -> reviewed "Finding inspected"
        investigationFailed -> reviewed "Alert inspected"
        reviewed -> closed "No further work"
        reviewed -> followup "Another pass"
        reviewed -> hAuthority "Product change considered"
        hAuthority -> awpNominated "AWP improvement selected"
        awpNominated -> awpAccepted "Task submitted"
        awpAccepted -> awpArtifact "Sandbox completed"
        awpAccepted -> awpHeld "Task failed"
        awpArtifact -> awpQualified "Gate passed"
        awpArtifact -> awpHeld "Gate failed or unjudged"
        awpQualified -> awpPr "PR opened"
        awpPr -> prLyrics "Diff supplied to lyric generator"
        awpPr -> soundtrackHeld "Generation unavailable"
        prLyrics -> prLyricsApproved "Manifest approved"
        prLyrics -> soundtrackHeld "Manifest rejected"
        prLyricsApproved -> prSong "Audio rendered"
        prLyricsApproved -> soundtrackHeld "Render failed"
        prSong -> soundtrack "Artifact attached"
        soundtrackHeld -> hSoundtrack "Exception unresolved"
        hSoundtrack -> prHeld "If soundtrack is required"
        hSoundtrack -> awpApproved "If an exception is authorized and review passes"
        soundtrack -> awpApproved "Review passed"
        soundtrack -> awpRejected "Changes requested"
        awpApproved -> deployed "Deploy and checks passed"
        awpApproved -> deployFailed "Checks failed"
        deployFailed -> recovered "Recovery completed"
        reviewed -> nominated "One component selected"
        nominated -> hBoundary "Replaceability questioned"
        hBoundary -> boundary "Boundary agreed"
        hBoundary -> boundaryHeld "Boundary disputed"
        boundary -> cut "Spec ratified"
        boundary -> cutHeld "Spec blocked"
        cut -> fence "Fence proved"
        cut -> fenceFailed "Fence not proved"
        fence -> candidates "Parallel generation completed"
        fence -> generationFailed "Generation failed"
        candidates -> generationFailed "One candidate failed"
        candidates -> measured "Independent gate ran"
        measured -> candidateHeld "Failed or unjudged"
        measured -> eligible "Eligible evidence joined"
        eligible -> hSelection "Selection authority checked"
        hSelection -> selected "One digest selected"
        hSelection -> selectionRefused "No valid selection"
        selected -> awpPr "AWP target rejoins PR workflow"
        selected -> otherPr "Other repository target"
        otherPr -> otherApproved "Review passed"
        otherPr -> otherRejected "Changes requested"
        otherApproved -> promoted "Release verified"
        otherApproved -> releaseFailed "Release held"
        candidateHeld -> learning "Finding reviewed"
        selectionRefused -> learning "Finding reviewed"
        deployed -> learning "Operational evidence reviewed"
        deployFailed -> learning "Failure reviewed"
        promoted -> learning "Operational evidence reviewed"
        releaseFailed -> learning "Failure reviewed"
    }
    views {
        custom one-big-wall "One owner EventStorming Big Picture" "Tentative timeline. Purple border means proposed; arrows are narrative succession, not an event bus." {
            include *
            autoLayout lr
        }
        styles {
            element "Event" {
                shape RoundedBox
                background #ffd28a
                color #4b2d15
                stroke #dd8e2e
                width 230
                height 90
                fontSize 18
            }
            element "Pivotal" {
                shape RoundedBox
                background #ffe0a3
                color #4b2d15
                stroke #c7443f
                strokeWidth 4
                width 230
                height 90
                fontSize 18
            }
            element "ProposedEvent" {
                shape RoundedBox
                background #ffead0
                color #4b2d15
                stroke #8c70bd
                strokeWidth 3
                width 230
                height 90
                fontSize 18
            }
            element "ProposedPivotal" {
                shape RoundedBox
                background #ffead0
                color #4b2d15
                stroke #c7443f
                strokeWidth 4
                width 230
                height 90
                fontSize 18
            }
            element "Hotspot" {
                shape RoundedBox
                background #f8d4de
                color #662d43
                stroke #cc7890
                width 230
                height 90
                fontSize 18
            }
            relationship "Relationship" {
                color #94745c
                thickness 2
                fontSize 14
            }
        }
    }
}
