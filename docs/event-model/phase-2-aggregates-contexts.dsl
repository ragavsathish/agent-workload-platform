workspace "EventStorming phase 2: aggregate and context boundaries" "Candidate domain boundaries behind the one big wall; not deployment topology." {
    model {
        group "C1 · Voice Conversation" {
            voiceSession = element "A1 · Voice Session" "Current aggregate" "Owns turn order, completion, and interruption." "CurrentAggregate"
        }
        group "C2 · Tasking" {
            taskRequest = element "A2 · Task Request" "Current aggregate" "One request ID to one canonical input and native task." "CurrentAggregate"
            agentTask = element "A3 · Agent Task" "Current aggregate" "Task checkpoint, progress, and terminal outcome." "CurrentAggregate"
            songGeneration = element "A6 · Song Generation" "Logical candidate" "One lyric task and at most one render task; approval gap." "CandidateAggregate"
        }
        group "C3 · Personal Knowledge" {
            knowledgeReview = element "A4 · Knowledge Item Review" "Current records" "Attributable review history and current interpretation." "CurrentAggregate"
            dailyJournal = element "A5 · Daily Journal" "Logical candidate" "Owner, date, timezone, and source-set identity." "CandidateAggregate"
        }
        group "C4 · Operational Incidents" {
            alertIncident = element "A7 · Alert Incident" "Current aggregate" "Rule, fingerprint, incident epoch, and submission state." "CurrentAggregate"
        }
        group "C5 · Measurement and Qualification" {
            measurement = element "Qualified measurement" "Evidence, not aggregate" "Oracle-qualified results keyed to source and version." "Evidence"
        }
        group "C6 · AWP Change Governance" {
            changeCase = element "A8 · AWP Change Case" "Proposed aggregate" "Evidence-linked change, revision, qualification, PR, disposition." "ProposedAggregate"
        }
        group "C7 · Component Regeneration" {
            spec = element "A9 · Component Specification" "Proposed aggregate" "Versioned ratified cuts; old cuts remain immutable." "ProposedAggregate"
            run = element "A10 · Regeneration Run" "Proposed aggregate" "Pinned cut and distinct parallel candidate evidence." "ProposedAggregate"
            selection = element "A11 · Candidate Selection" "Proposed aggregate" "One selected digest against the current base revision." "ProposedAggregate"
        }
        group "C8 · Agent Execution" {
            session = element "Agent Session" "Execution boundary" "Workspace mount and capability surface; no task admission authority." "Boundary"
        }
        group "C9 · Repository Delivery" {
            repoChange = element "A12 · Repository Change" "External aggregate" "Target PR, pinned revision, and review disposition." "ExternalAggregate"
            deployment = element "A13 · Deployment Attempt" "Logical candidate" "Verification and recovery refer to one target revision." "CandidateAggregate"
        }

        voiceSession -> taskRequest "Requests durable work"
        voiceSession -> knowledgeReview "Supplies attributed turn evidence"
        voiceSession -> dailyJournal "Supplies source turns"
        taskRequest -> agentTask "Admits one task"
        agentTask -> session "Starts bounded execution"
        agentTask -> changeCase "Offers reviewed change artifact"
        songGeneration -> repoChange "Supplies soundtrack reference"
        alertIncident -> taskRequest "Submits bounded investigation"
        alertIncident -> changeCase "Offers reviewed finding"
        measurement -> changeCase "Supplies qualified verdict"
        measurement -> selection "Supplies candidate evidence"
        changeCase -> repoChange "Requests AWP PR and release"
        spec -> run "Pins one cut"
        run -> selection "Offers eligible candidates"
        selection -> repoChange "Requests target repository PR"
        repoChange -> deployment "Approved revision may be deployed"
    }
    views {
        custom phase-2-boundaries "Phase 2 · Aggregates and bounded contexts" "Conceptual decision ownership. Current, candidate, proposed, and external boundaries are marked; no event bus is implied." {
            include *
            autoLayout lr
        }
        styles {
            element "CurrentAggregate" {
                shape RoundedBox
                background #e7c078
                color #38250f
                stroke #a96c18
                width 250
                height 105
                fontSize 18
            }
            element "CandidateAggregate" {
                shape RoundedBox
                background #f5dba8
                color #38250f
                stroke #8c70bd
                strokeWidth 3
                width 250
                height 105
                fontSize 18
            }
            element "ProposedAggregate" {
                shape RoundedBox
                background #ffead0
                color #38250f
                stroke #8c70bd
                strokeWidth 3
                width 250
                height 105
                fontSize 18
            }
            element "ExternalAggregate" {
                shape RoundedBox
                background #dbeafe
                color #183153
                stroke #3877be
                width 250
                height 105
                fontSize 18
            }
            element "Evidence" {
                shape RoundedBox
                background #d8efdc
                color #18452a
                stroke #4d9f65
                width 250
                height 105
                fontSize 18
            }
            element "Boundary" {
                shape RoundedBox
                background #e2e8f0
                color #263545
                stroke #64748b
                width 250
                height 105
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
