workspace "Component regeneration EventStorming walk" "Proposed component-level clean-room regeneration with parallel candidates and single promotion." {
    model {
        owner = element "Component owner" "Actor" "Chooses the target and ratifies durable intent." "Actor"
        nominated = element "Component nominated" "Proposed event" "Repository, component, base revision, and reason identified." "Event"
        boundary = element "Confirm replaceable boundary" "Proposed policy" "Versioned interface, exclusive writes, and caller obligations." "Policy"
        cut = element "Spec cut ratified" "Proposed pivotal event" "Behavior, invariants, provenance, evaluation, and boundary pinned by digest." "Pivotal"
        fenceCheck = element "Verify clean room" "Proposed policy" "Prove previous answers and private oracle are unreachable." "Policy"
        fence = element "Clean room verified" "Proposed pivotal event" "Old source, prior answers, and private oracle unreachable." "Pivotal"
        candidateA = element "Candidate A generated" "Proposed event" "Own ID, model/config digest, source and artifact digests." "Event"
        candidateB = element "Candidate B generated" "Proposed event" "Independent generation from the same spec cut." "Event"
        measurements = element "Independent evidence recorded" "Proposed read model" "Boundary tests, caller checks, oracle, vetoes, and denominators." "ReadModel"
        eligible = element "Eligible set projected" "Proposed policy" "Join each candidate's complete evidence by cut and boundary version." "Policy"
        held = element "Run or candidate held" "Proposed alternative event" "Fence, generation, or gate failed or was unjudged." "Event"
        selected = element "One candidate selected" "Proposed pivotal event" "Reviewer records digest against current base revision." "Pivotal"
        pr = element "Repository change reviewed" "Proposed event" "PR carries code, spec cut, measurements, provenance, and rollback." "Event"
        promoted = element "Component promoted" "Proposed event" "The selected digest passed the target repository's release rules." "Event"
        observed = element "Operational evidence observed" "Proposed read model" "Runtime measurements or incidents challenge the cut." "ReadModel"
        revised = element "Spec revision accepted" "Proposed event" "Reviewed learning enters the next cut." "Event"
        authority = element "Who ratifies the spec and selection?" "Hot Spot" "Owner and reviewer authority, including non-AWP repositories." "Hotspot"

        owner -> nominated "Requests bounded regeneration"
        nominated -> boundary "Identify one owned component"
        boundary -> cut "Ratify durable obligations"
        cut -> fenceCheck "Prepare clean room"
        fenceCheck -> fence "Proof passes"
        fence -> candidateA "Start generation in parallel"
        fence -> candidateB "Start generation in parallel"
        fenceCheck -> held "Proof fails"
        candidateA -> measurements "Submit candidate evidence"
        candidateB -> measurements "Submit candidate evidence"
        measurements -> eligible "Project complete qualified set"
        measurements -> held "Failed or unjudged gate"
        eligible -> selected "Single reviewed decision"
        eligible -> held "No eligible candidate"
        selected -> pr "Open target repository PR"
        pr -> promoted "Normal review and release"
        promoted -> observed "Measure operation"
        held -> revised "Record gap or counterexample"
        observed -> revised "Review production lesson"
        selected -> authority "Resolve decision rights"
    }
    views {
        custom component-regeneration "Component regeneration · one EventStorming walk" "Proposed only; parallel generation and evidence converge before one reviewed selection." {
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
                background #ffead0
                color #4b2d15
                stroke #8c70bd
                strokeWidth 3
                width 320
                height 110
            }
            element "Pivotal" {
                shape RoundedBox
                background #ffe0a3
                color #4b2d15
                stroke #c7443f
                strokeWidth 5
                width 320
                height 110
            }
            element "Policy" {
                shape RoundedBox
                background #e4dcf6
                color #402b64
                stroke #8c70bd
                width 320
                height 110
            }
            element "ReadModel" {
                shape RoundedBox
                background #d8efdc
                color #18452a
                stroke #4d9f65
                width 320
                height 110
            }
            element "Hotspot" {
                shape RoundedBox
                background #f8d4de
                color #662d43
                stroke #cc7890
                width 320
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
