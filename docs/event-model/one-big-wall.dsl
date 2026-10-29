workspace "One owner EventStorming wall" "One event-centred design wall for ordinary work, AWP changes, and component regeneration." {
    model {
        needExpressed = element "Need expressed" "Entry event" "Owner starts a conversation, task, or song." "Event"
        alertFired = element "Alert fired" "Independent entry event" "Managed operational signal starts an investigation." "Event"
        group "D1 · C1 · Voice Conversation · Current" {
            d1Command = element "Handle voice turn" "Command" "Owner or system request." "Command"
            d1Read = element "Voice session, transcript" "Read model" "Information needed for the decision." "ReadModel"
            d1Handler = element "Pi Voice turn handler" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d1Deriver = element "Session outcome; model answer is an effect" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d1Repo = element "Voice session state" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d1Aggregate = element "D1 · A1 · Voice Session" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d1Event = element "Voice turn completed / interrupted" "Domain event" "A turn has an inspectable outcome." "Event"
        }
        group "D2 · C2 · Tasking · Current + agreed" {
            d2Command = element "Submit bounded task" "Command" "Owner or system request." "Command"
            d2Read = element "Identity, workspace, prior request" "Read model" "Information needed for the decision." "ReadModel"
            d2Handler = element "Gateway → Pi Durable owner" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d2Deriver = element "Admit / same ID / conflict" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d2Repo = element "Owner request ledger" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d2Aggregate = element "D2 · A2 · Task Request" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d2Event = element "Task accepted / refused" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D3 · C2 · Tasking · Current" {
            d3Command = element "Run accepted task" "Command" "Owner or system request." "Command"
            d3Read = element "Task, mode, grant, image" "Read model" "Information needed for the decision." "ReadModel"
            d3Handler = element "Pi Durable task handler" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d3Deriver = element "Project terminal result / failure" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d3Repo = element "Checkpoint + artifact store" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d3Aggregate = element "D3 · A3 · Agent Task" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d3Event = element "Task result captured" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D4 · C3 · Personal Knowledge · Current" {
            d4Command = element "Review suggestion" "Command" "Owner or system request." "Command"
            d4Read = element "Source and review state" "Read model" "Information needed for the decision." "ReadModel"
            d4Handler = element "Completed-turn + owner review" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d4Deriver = element "Validate target + owner action" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d4Repo = element "Oxigraph review history" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d4Aggregate = element "D4 · A4 · Knowledge Item Review" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d4Event = element "Knowledge reviewed" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D5 · C3 · Personal Knowledge · Current" {
            d5Command = element "Build daily account" "Command" "Owner or system request." "Command"
            d5Read = element "Owner, date, source set" "Read model" "Information needed for the decision." "ReadModel"
            d5Handler = element "Daily-journal task handler" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d5Deriver = element "Eligible sources, stable ID" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d5Repo = element "Task ledger + journal writer" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d5Aggregate = element "D5 · A5 · Daily Journal" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d5Event = element "Daily account written" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D6 · C2 · Tasking · Current + gap" {
            d6Command = element "Create and approve song" "Command" "Owner or system request." "Command"
            d6Read = element "Manifest, render, approval" "Read model" "Information needed for the decision." "ReadModel"
            d6Handler = element "SongService + owner" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d6Deriver = element "decide_render / project_song" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d6Repo = element "Lyric/render tasks + audio" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d6Aggregate = element "D6 · A6 · Song Generation" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d6Event = element "Song stored / held" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D7 · C4 · Operational Incidents · Current" {
            d7Command = element "Investigate alert" "Command" "Owner or system request." "Command"
            d7Read = element "Alert, rule, incident epoch" "Read model" "Information needed for the decision." "ReadModel"
            d7Handler = element "Host monitor → Pi Durable" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d7Deriver = element "Incident key + dedupe" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d7Repo = element "SQLite incident + task" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d7Aggregate = element "D7 · A7 · Alert Incident" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d7Event = element "Investigation finding captured / unjudged" "Domain event" "An alert investigation has an inspectable outcome." "Event"
        }
        group "D8 · Cross-context owner decision · Mixed" {
            d8Command = element "Close / follow up / nominate" "Command" "Owner or system request." "Command"
            d8Read = element "Outcome and provenance" "Read model" "Information needed for the decision." "ReadModel"
            d8Handler = element "Owner; future coordinator" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d8Deriver = element "Owner choice; case creation proposed" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d8Repo = element "Source records; case proposed" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d8Aggregate = element "D8 · A8 · Change Case, if nominated" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d8Event = element "Outcome reviewed" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D9 · C6 · AWP Change Governance · Proposed" {
            d9Command = element "Qualify AWP change" "Command" "Owner or system request." "Command"
            d9Read = element "Diff, oracle, checks" "Read model" "Information needed for the decision." "ReadModel"
            d9Handler = element "Qualification handler" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d9Deriver = element "Pass / fail / unjudged" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d9Repo = element "Task artifact + verdict" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d9Aggregate = element "D9 · A8 · AWP Change Case" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d9Event = element "Change qualified / held" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D10 · C9 · Repository Delivery · Manual + proposed" {
            d10Command = element "Prepare PR soundtrack" "Command" "Owner or system request." "Command"
            d10Read = element "PR diff, lyrics, audio" "Read model" "Information needed for the decision." "ReadModel"
            d10Handler = element "Maintainer + SongService" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d10Deriver = element "Manifest readiness; completeness" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d10Repo = element "Song tasks + Git PR" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d10Aggregate = element "D10 · A6 · Song / A12 · PR" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d10Event = element "Soundtrack attached / held" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D11 · C9 · Repository Delivery · Manual + proposed" {
            d11Command = element "Review, deploy, verify" "Command" "Owner or system request." "Command"
            d11Read = element "PR, revision, verify report" "Read model" "Information needed for the decision." "ReadModel"
            d11Handler = element "Reviewer + operator" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d11Deriver = element "Review; pass / fail / unjudged" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d11Repo = element "Git PR + deployment report" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d11Aggregate = element "D11 · A12 · PR / A13 · Deployment" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d11Event = element "Deployment verified / failed" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D12 · C7 · Component Regeneration · Proposed" {
            d12Command = element "Ratify component cut" "Command" "Owner or system request." "Command"
            d12Read = element "Boundary, behavior, gate" "Read model" "Information needed for the decision." "ReadModel"
            d12Handler = element "Component owner" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d12Deriver = element "Complete attributable cut" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d12Repo = element "Target repo + spec bundle" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d12Aggregate = element "D12 · A9 · Component Specification" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d12Event = element "Spec cut ratified / held" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D13 · C7 · Component Regeneration · Proposed" {
            d13Command = element "Fence + generate candidates" "Command" "Owner or system request." "Command"
            d13Read = element "Cut, inputs, candidate IDs" "Read model" "Information needed for the decision." "ReadModel"
            d13Handler = element "Fence + generator handlers" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d13Deriver = element "Fence proof; distinct IDs" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d13Repo = element "Run ledger + workspaces" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d13Aggregate = element "D13 · A10 · Regeneration Run" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d13Event = element "Candidates generated / failed" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D14 · C7 · Component Regeneration · Proposed" {
            d14Command = element "Measure + select candidate" "Command" "Owner or system request." "Command"
            d14Read = element "Evidence, eligible set, base" "Read model" "Information needed for the decision." "ReadModel"
            d14Handler = element "Gate + selection handler" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d14Deriver = element "Eligible; one versioned choice" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d14Repo = element "Evidence + selection" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d14Aggregate = element "D14 · A10 · Run / A11 · Selection" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d14Event = element "One candidate selected / refused" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        group "D15 · C9 · Repository Delivery · Proposed" {
            d15Command = element "Open target PR + release" "Command" "Owner or system request." "Command"
            d15Read = element "Digest, PR, release finding" "Read model" "Information needed for the decision." "ReadModel"
            d15Handler = element "Maintainer + spec owner" "Command handler" "Authenticates, loads, decides, commits, and reports." "Handler"
            d15Deriver = element "Release outcome; later cut" "Deriver" "Decision logic or explicit human/effect boundary." "Deriver"
            d15Repo = element "Target Git + spec history" "Repository or authority" "Owns the relevant state or external authority." "Repository"
            d15Aggregate = element "D15 · A12 · PR / A13 · Deployment" "Candidate aggregate" "Phase 2 consistency boundary." "Aggregate"
            d15Event = element "Target release verified / held" "Domain event" "Observable outcome; current/proposed status is in the group name." "Event"
        }
        needExpressed -> d1Command "Conversation"
        needExpressed -> d2Command "Direct delegation"
        needExpressed -> d6Command "Creative request"
        alertFired -> d7Command "Selected investigation"
        d1Command -> d1Handler "Issues"
        d1Read -> d1Handler "Supplies decision facts"
        d1Repo -> d1Handler "Loads state and version"
        d1Handler -> d1Deriver "Asks for decision"
        d1Deriver -> d1Aggregate "Applies rule"
        d1Aggregate -> d1Event "Records outcome"
        d2Command -> d2Handler "Issues"
        d2Read -> d2Handler "Supplies decision facts"
        d2Repo -> d2Handler "Loads state and version"
        d2Handler -> d2Deriver "Asks for decision"
        d2Deriver -> d2Aggregate "Applies rule"
        d2Aggregate -> d2Event "Records outcome"
        d3Command -> d3Handler "Issues"
        d3Read -> d3Handler "Supplies decision facts"
        d3Repo -> d3Handler "Loads state and version"
        d3Handler -> d3Deriver "Asks for decision"
        d3Deriver -> d3Aggregate "Applies rule"
        d3Aggregate -> d3Event "Records outcome"
        d4Command -> d4Handler "Issues"
        d4Read -> d4Handler "Supplies decision facts"
        d4Repo -> d4Handler "Loads state and version"
        d4Handler -> d4Deriver "Asks for decision"
        d4Deriver -> d4Aggregate "Applies rule"
        d4Aggregate -> d4Event "Records outcome"
        d5Command -> d5Handler "Issues"
        d5Read -> d5Handler "Supplies decision facts"
        d5Repo -> d5Handler "Loads state and version"
        d5Handler -> d5Deriver "Asks for decision"
        d5Deriver -> d5Aggregate "Applies rule"
        d5Aggregate -> d5Event "Records outcome"
        d6Command -> d6Handler "Issues"
        d6Read -> d6Handler "Supplies decision facts"
        d6Repo -> d6Handler "Loads state and version"
        d6Handler -> d6Deriver "Asks for decision"
        d6Deriver -> d6Aggregate "Applies rule"
        d6Aggregate -> d6Event "Records outcome"
        d7Command -> d7Handler "Issues"
        d7Read -> d7Handler "Supplies decision facts"
        d7Repo -> d7Handler "Loads state and version"
        d7Handler -> d7Deriver "Asks for decision"
        d7Deriver -> d7Aggregate "Applies rule"
        d7Aggregate -> d7Event "Records outcome"
        d8Command -> d8Handler "Issues"
        d8Read -> d8Handler "Supplies decision facts"
        d8Repo -> d8Handler "Loads state and version"
        d8Handler -> d8Deriver "Asks for decision"
        d8Deriver -> d8Aggregate "Applies rule"
        d8Aggregate -> d8Event "Records outcome"
        d9Command -> d9Handler "Issues"
        d9Read -> d9Handler "Supplies decision facts"
        d9Repo -> d9Handler "Loads state and version"
        d9Handler -> d9Deriver "Asks for decision"
        d9Deriver -> d9Aggregate "Applies rule"
        d9Aggregate -> d9Event "Records outcome"
        d10Command -> d10Handler "Issues"
        d10Read -> d10Handler "Supplies decision facts"
        d10Repo -> d10Handler "Loads state and version"
        d10Handler -> d10Deriver "Asks for decision"
        d10Deriver -> d10Aggregate "Applies rule"
        d10Aggregate -> d10Event "Records outcome"
        d11Command -> d11Handler "Issues"
        d11Read -> d11Handler "Supplies decision facts"
        d11Repo -> d11Handler "Loads state and version"
        d11Handler -> d11Deriver "Asks for decision"
        d11Deriver -> d11Aggregate "Applies rule"
        d11Aggregate -> d11Event "Records outcome"
        d12Command -> d12Handler "Issues"
        d12Read -> d12Handler "Supplies decision facts"
        d12Repo -> d12Handler "Loads state and version"
        d12Handler -> d12Deriver "Asks for decision"
        d12Deriver -> d12Aggregate "Applies rule"
        d12Aggregate -> d12Event "Records outcome"
        d13Command -> d13Handler "Issues"
        d13Read -> d13Handler "Supplies decision facts"
        d13Repo -> d13Handler "Loads state and version"
        d13Handler -> d13Deriver "Asks for decision"
        d13Deriver -> d13Aggregate "Applies rule"
        d13Aggregate -> d13Event "Records outcome"
        d14Command -> d14Handler "Issues"
        d14Read -> d14Handler "Supplies decision facts"
        d14Repo -> d14Handler "Loads state and version"
        d14Handler -> d14Deriver "Asks for decision"
        d14Deriver -> d14Aggregate "Applies rule"
        d14Aggregate -> d14Event "Records outcome"
        d15Command -> d15Handler "Issues"
        d15Read -> d15Handler "Supplies decision facts"
        d15Repo -> d15Handler "Loads state and version"
        d15Handler -> d15Deriver "Asks for decision"
        d15Deriver -> d15Aggregate "Applies rule"
        d15Aggregate -> d15Event "Records outcome"
        d1Event -> d2Command "Delegated work"
        d2Event -> d3Command "Accepted task"
        d1Event -> d4Command "Completed turn"
        d1Event -> d5Command "Daily account"
        d1Event -> d6Command "Creative request"
        d3Event -> d8Command "Task outcome reviewed"
        d4Event -> d8Command "Knowledge reviewed"
        d5Event -> d8Command "Daily account reviewed"
        d6Event -> d8Command "Song reviewed"
        d7Event -> d8Command "Finding reviewed"
        d8Event -> d9Command "AWP change nominated"
        d9Event -> d10Command "Qualified change"
        d10Event -> d11Command "PR reviewed"
        d8Event -> d12Command "Component nominated"
        d12Event -> d13Command "Cut ratified"
        d13Event -> d14Command "Candidates measured"
        d14Event -> d15Command "One candidate selected"
        d15Event -> d10Command "AWP target joins PR path"
    }
    views {
        custom one-big-wall "One EventStorming wall · events, decisions, and boundaries" "Phase 1 and Phase 2 notes are grouped with each event. Arrows are narrative succession, not an event bus." {
            include *
            autoLayout lr
        }
        styles {
            element "Event" {
                shape RoundedBox
                background #ffd08a
                color #203047
                stroke #9b5914
                width 270
                height 95
                fontSize 17
            }
            element "Command" {
                shape RoundedBox
                background #daeafb
                color #203047
                stroke #235385
                width 270
                height 95
                fontSize 17
            }
            element "Handler" {
                shape RoundedBox
                background #daeafb
                color #203047
                stroke #235385
                width 270
                height 95
                fontSize 17
            }
            element "ReadModel" {
                shape RoundedBox
                background #dff2e1
                color #203047
                stroke #2d7040
                width 270
                height 95
                fontSize 17
            }
            element "Deriver" {
                shape RoundedBox
                background #eadef6
                color #203047
                stroke #68469c
                width 270
                height 95
                fontSize 17
            }
            element "Repository" {
                shape RoundedBox
                background #e3e8ed
                color #203047
                stroke #495d70
                width 270
                height 95
                fontSize 17
            }
            element "Aggregate" {
                shape RoundedBox
                background #fff1ad
                color #203047
                stroke #8a6b10
                width 270
                height 95
                fontSize 17
            }
            relationship "Relationship" {
                color #36516a
                thickness 3
                fontSize 13
            }
        }
    }
}
