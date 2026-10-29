workspace "AWP EventStorming Big Picture" "Candidate events and hotspots derived from Gherkin; pending domain walkthrough." {
    model {
        a1 = element "Voice turn completed" "Candidate event" "A conversation turn completed." "Event"
        a2 = element "Task accepted" "Candidate pivotal event" "Durable owner accepted a task." "Pivotal"
        a3 = element "Task execution started" "Candidate event" "A task attempt started." "Event"
        a4 = element "Public progress recorded" "Candidate event" "A safe bounded progress item became visible." "Event"
        a5 = element "Result artifact captured" "Candidate pivotal event" "A result artifact became available." "Pivotal"
        a6 = element "Task completed" "Candidate event" "The task reached a successful terminal state." "Event"
        aAbort = element "Task aborted" "Alternative event" "An accepted task was aborted." "Event"
        aFail = element "Task failed" "Alternative event" "An attempt failed." "Event"
        aContinue = element "Task continuation accepted" "Alternative event" "A follow-up was accepted." "Event"
        h1 = element "H1 · Follow-up stream identity?" "Hotspot" "Same task stream or linked task?" "Hotspot"
        h2 = element "H2 · Artifact timing?" "Hotspot" "When is an artifact guaranteed before completion?" "Hotspot"
        a1 -> a2 "Optional delegation"
        a2 -> a3 "Start attempt"
        a3 -> a4 "Report safe progress"
        a4 -> a5 "Capture result"
        a5 -> a6 "Complete"
        a2 -> aAbort "Abort"
        a3 -> aFail "Failure"
        a4 -> aContinue "Follow-up"
        aContinue -> h1 "Clarify"
        a5 -> h2 "Clarify"

        b1 = element "Owner turn completed" "Candidate event" "An owner turn ended." "Event"
        b2 = element "Journal processing completed" "Candidate event" "Journal work completed." "Event"
        bClass = element "Classification completed" "Parallel event" "Classification work completed independently." "Event"
        b3 = element "Journal entry recorded" "Candidate pivotal event" "A journal entry became queryable." "Pivotal"
        b4 = element "Journal correction recorded" "Candidate event" "A correction entered review history." "Event"
        bReview = element "Assertion review recorded" "Alternative event" "An assertion decision entered review history." "Event"
        b5 = element "Journal entry removed" "Candidate event" "The entry was removed from current queries." "Event"
        h3 = element "H3 · Atomic correction?" "Hotspot" "Are history and current entry updated atomically?" "Hotspot"
        h4 = element "H4 · Removal rights?" "Hotspot" "Who may remove, and what history remains?" "Hotspot"
        b1 -> b2 "Process journal"
        b1 -> bClass "Classify independently"
        b2 -> b3 "Record entry"
        b3 -> b4 "Correct"
        b3 -> bReview "Review assertion"
        b4 -> b5 "Remove if requested"
        b4 -> h3 "Clarify"
        b5 -> h4 "Clarify"

        c1 = element "Image build requested" "Candidate event" "A missing execution image was requested." "Event"
        c2 = element "Host job accepted" "Candidate event" "The host accepted a work item." "Event"
        c3 = element "Build context verified" "Candidate pivotal event" "Context size and digest matched." "Pivotal"
        c4 = element "Image built" "Candidate event" "Docker finished the image build." "Event"
        c5 = element "Image archive validated" "Candidate event" "Archive references were complete." "Event"
        c6 = element "Image handoff prepared" "Candidate pivotal event" "A portable handoff became available." "Pivotal"
        c7 = element "Image cache imported" "Candidate event" "The shared cache accepted the handoff." "Event"
        cRegistry = element "Registry images prepared" "Alternative event" "A Compose cache job prepared registry images." "Event"
        h5 = element "H5 · Job recovery?" "Hotspot" "What happens after a host process restart?" "Hotspot"
        h6 = element "H6 · Built image verification?" "Hotspot" "Who verifies image IDs before cache promotion?" "Hotspot"
        c1 -> c2 "Submit"
        c2 -> c3 "Upload context"
        c3 -> c4 "Build"
        c4 -> c5 "Export and validate"
        c5 -> c6 "Publish handoff"
        c6 -> c7 "Import"
        c2 -> cRegistry "Compose cache branch"
        cRegistry -> c6 "Prepare handoff"
        c2 -> h5 "Clarify"
        c6 -> h6 "Clarify"

        eWorkspace = element "Task workspace prepared" "Candidate event" "The accepted task has a working directory." "Event"
        eMode = element "Select coding tool mode" "Policy" "The owner selects host or Gondolin tools without changing task identity." "Policy"
        eImage = element "Resolve execution image" "Policy" "Use the default image, a verified cache hit, or request a repository image build." "Policy"
        eReady = element "Execution image registered" "Candidate event" "A verified image reference is ready for the task VM." "Event"
        eVm = element "Task VM started" "Candidate pivotal event" "The isolated Gondolin coding sandbox starts with the task workspace mounted." "Pivotal"
        eVmWrite = element "VM workspace changed" "Candidate event" "Coding tools write inside the mounted task workspace." "Event"
        eHostWrite = element "Host workspace changed" "Alternative event" "Host coding tools write in the task workspace." "Event"
        eHandoff = element "H8 · Image needed?" "Hotspot" "Repository image build only on cache miss; scratch can use the default image." "Hotspot"
        a2 -> eWorkspace "Prepare workspace"
        eWorkspace -> eMode "Choose tools"
        eMode -> eImage "Gondolin mode"
        eMode -> eHostWrite "Host mode"
        eImage -> eReady "Default or cache hit"
        eImage -> c6 "Repository cache miss"
        c6 -> eReady "Verify and register"
        eReady -> eVm "Start isolated sandbox"
        eVm -> eVmWrite "Run coding tools"
        eVmWrite -> a5 "Capture result"
        eHostWrite -> a5 "Capture result"
        eImage -> eHandoff "Clarify"

        d1 = element "Host prerequisites confirmed" "Candidate event" "The host passed readiness checks." "Event"
        d2 = element "Native services installed" "Candidate event" "Required host services were installed." "Event"
        d3 = element "Deployment converged" "Candidate pivotal event" "The deployed stack reached its target state." "Pivotal"
        d4 = element "Infrastructure verification passed" "Candidate event" "Verification produced a pass verdict." "Event"
        dFail = element "Infrastructure verification failed" "Alternative event" "Verification produced a failure verdict." "Event"
        dUnknown = element "Infrastructure verification unjudged" "Alternative event" "A required check could not be judged." "Event"
        h7 = element "H7 · Verdict retention?" "Hotspot" "Which verdicts should survive deployments?" "Hotspot"
        d1 -> d2 "Install"
        d2 -> d3 "Deploy"
        d3 -> d4 "Verify"
        d3 -> dFail "Failure branch"
        d3 -> dUnknown "Unavailable ingress"
        d4 -> h7 "Clarify"
    }

    views {
        custom lane-a "A · Conversation to durable work" "Main path, alternatives, and hotspots" {
            include a1 a2 a3 a4 a5 a6 aAbort aFail aContinue h1 h2
            autoLayout lr
        }
        custom lane-b "B · Completed turn to reviewed knowledge" "Parallel processing, review, and hotspots" {
            include b1 b2 bClass b3 b4 bReview b5 h3 h4
            autoLayout lr
        }
        custom lane-c "C · Cache miss to image handoff" "Verified build and Compose cache alternatives" {
            include c1 c2 c3 c4 c5 c6 c7 cRegistry h5 h6
            autoLayout lr
        }
        custom lane-d "D · Host readiness to verification evidence" "Deployment and verification outcomes" {
            include d1 d2 d3 d4 dFail dUnknown h7
            autoLayout lr
        }
        custom lane-e "Task to coding sandbox" "Accepted task, conditional image handoff, task VM, and host alternative" {
            include a2 eWorkspace eMode eImage c6 eReady eVm eVmWrite eHostWrite a5 eHandoff
            autoLayout lr
        }
        styles {
            element "Event" {
                shape RoundedBox
                background #ffd28a
                color #4b2d15
                stroke #dd8e2e
                width 340
                height 130
                fontSize 26
            }
            element "Pivotal" {
                shape RoundedBox
                background #ffe0a3
                color #4b2d15
                stroke #c7443f
                strokeWidth 5
                width 340
                height 130
                fontSize 26
            }
            element "Hotspot" {
                shape RoundedBox
                background #f8d4de
                color #662d43
                stroke #cc7890
                width 340
                height 110
                fontSize 24
            }
            element "Policy" {
                shape RoundedBox
                background #e4dcf6
                color #402b64
                stroke #8c70bd
                width 340
                height 130
                fontSize 26
            }
            relationship "Relationship" {
                color #94745c
                thickness 3
                fontSize 18
            }
        }
    }
}
