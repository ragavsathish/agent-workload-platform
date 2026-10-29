workspace "Proposed durable task event history" "Proposed C4 model; this event store is not deployed." {
    model {
        user = person "Owner" "Submits, follows, aborts, retries, and continues tasks."

        awp = softwareSystem "Agent Workload Platform" "Proposed task-event persistence boundary." {
            browser = container "Task Board" "Shows owner-scoped task status and public progress." "Flutter Web"
            gateway = container "Agent Gateway" "Authenticates owner and applies public task policy." "Python"
            owner = container "Pi Durable Owner" "Single writer for native task commands and event projections." "Node.js" {
                commands = component "Command Handler" "Validates command, ownership, idempotency, and expected version."
                taskRunner = component "Task Runner" "Executes task attempt and captures a bounded result."
                projector = component "Projection Builder" "Applies committed events to status and public progress."
                queries = component "Task Query API" "Returns owner-scoped task read models."
            }
            ledger = container "Task Event and Projection Store" "Append-only per-task streams, command idempotency, and rebuildable read models." "SQLite" "Data Store,Proposed"
            artifacts = container "Result Store" "Verified workspace and result artifacts, referenced by digest." "S3-compatible" "Data Store"
        }

        user -> browser "Submits and follows tasks" "HTTPS"
        browser -> gateway "Requests commands and reads owner-scoped tasks" "HTTPS"
        gateway -> commands "Submits authorized task commands" "Private HTTP"
        gateway -> queries "Reads owner-scoped task projections" "Private HTTP"
        commands -> ledger "Appends ordered task events with command idempotency" "SQLite transaction"
        commands -> taskRunner "Starts accepted attempt" "In-process"
        taskRunner -> artifacts "Captures and verifies result" "S3 API"
        taskRunner -> commands "Requests safe progress and terminal transition" "In-process"
        ledger -> projector "Supplies committed task events for replay" "SQLite read"
        projector -> ledger "Writes status, result, and public-progress projections" "SQLite transaction"
        queries -> ledger "Reads task projections" "SQLite read"
    }

    views {
        component owner task-event-components "Proposed one-writer command and projection boundary" {
            include commands taskRunner projector queries ledger artifacts gateway
            autoLayout lr
        }

        dynamic owner submit-and-project "Proposed accepted task and result event flow" {
            user -> browser "Submits task"
            browser -> gateway "Passes owner-scoped request"
            gateway -> commands "Submits authorized command"
            commands -> ledger "Atomically appends TaskAccepted and command ID"
            commands -> taskRunner "Starts accepted attempt"
            taskRunner -> artifacts "Captures verified result artifact"
            taskRunner -> commands "Requests terminal transition"
            commands -> ledger "Appends TaskCompleted or TaskFailed"
            ledger -> projector "Replays committed events"
            projector -> ledger "Updates task and public-progress projections"
            autoLayout lr
        }

        styles {
            element "Person" {
                shape Person
                background #0b4f83
                color #ffffff
            }
            element "Container" {
                background #dbeafe
                color #102a43
            }
            element "Component" {
                background #e0f2fe
                color #0c4a6e
            }
            element "Data Store" {
                shape Cylinder
                background #fef3c7
                color #78350f
            }
            element "Proposed" {
                border dashed
            }
        }
    }
}
