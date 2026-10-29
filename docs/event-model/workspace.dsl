workspace "AWP behavior events" "C4 views derived from Gherkin outcomes; events are analysis vocabulary, not a new event bus." {
    model {
        user = person "Owner" "Talks, delegates work, and reviews knowledge."
        operator = person "Operator" "Deploys and verifies the local stack."
        docker = softwareSystem "Host Docker Engine" "Builds, pulls, and exports images on the host."
        hostTools = softwareSystem "Mac Host Coding Tools" "Runs file and shell tools when the owner selects host mode."

        awp = softwareSystem "Agent Workload Platform" "Interactive voice, durable work, knowledge, image preparation, and operations." {
            browser = container "Browser Voice Client" "Voice conversation and delegated-task board." "Flutter Web"
            knowledge = container "Journal and Knowledge UI" "Explore and review journal knowledge." "React"
            edge = container "Voice Edge" "Voice transport and owner-scoped browser APIs." "Python"
            pi = container "Pi Voice Service" "Persistent conversation and public transcript projection." "TypeScript"
            gateway = container "Agent Gateway" "Identity, task, and review policy." "Python"
            owner = container "Pi Durable Owner" "One writer for task lifecycle, progress, and results." "Node.js"
            productEffects = container "Product Effect Worker" "Bounded host child execution for journal, classification, daily journal, and song render tasks." "Python process"
            ownerStore = container "Durable Owner Store" "Native task checkpoints, result metadata, and bounded public progress." "SQLite" "Data Store"
            taskWorkspace = container "Task Workspace" "Working directory prepared for an accepted task; mounted read/write into its task VM in Gondolin mode." "Host filesystem" "Data Store"
            taskVm = container "Task Coding Sandbox" "Isolated per-task VM running Pi coding tools against the mounted workspace." "Gondolin"
            graph = container "Knowledge Graph Store" "Journal entries, assertions, and append-only review records." "Oxigraph" "Data Store"
            artifacts = container "Workspace and Result Store" "Task workspace and result artifacts." "S3-compatible" "Data Store"
            gitea = container "Git and Workflow State" "Repository revisions and image workflow runs." "Gitea" "Data Store"
            builder = container "Shared Image Builder" "Runs trusted image workflows inside a shared VM." "Gondolin"
            imageJob = container "Host Image Job API" "Authenticates, validates, and tracks build/cache jobs in memory." "HTTP"
            handoff = container "Image Handoff" "Verified image archives and indexes on the host filesystem." "Filesystem" "Data Store"
            automation = container "Deployment and Verification Runner" "Checks prerequisites, changes service state, and produces run evidence." "CLI process"
            collector = container "Host Storage Collector" "Samples host directories and Docker disk usage." "CLI process"
            telemetry = container "Metrics and Traces" "Stores measurements and traces for verification." "OpenTelemetry LGTM" "Data Store"
            grafana = container "Operational Health View" "Shows health and evidence for operators." "Grafana"
        }

        user -> browser "Talks and follows delegated work" "HTTPS/WebRTC"
        user -> knowledge "Explores and reviews knowledge" "HTTPS"
        operator -> automation "Deploys and verifies" "CLI"
        operator -> grafana "Inspects operational health" "HTTPS"
        browser -> edge "Sends turns and task requests; reads task state" "HTTPS/WebRTC"
        edge -> pi "Streams conversation turns and reads transcript" "HTTP"
        edge -> gateway "Submits and queries owner-scoped tasks" "HTTP"
        knowledge -> gateway "Queries entries and submits review commands" "HTTP"
        gateway -> owner "Submits, queries, aborts, and retries tasks" "Private HTTP"
        gateway -> graph "Queries entries and writes bounded review updates" "SPARQL"
        owner -> ownerStore "Writes checkpoints, results, and public progress" "SQLite"
        owner -> productEffects "Runs non-agent product task kinds as bounded child effects" "JSON over stdio"
        owner -> taskWorkspace "Prepares working directory for accepted task" "Filesystem"
        owner -> taskVm "Starts task VM with resolved execution image in Gondolin mode" "Gondolin"
        owner -> hostTools "Runs coding tools in host mode" "Process"
        taskVm -> taskWorkspace "Reads and writes mounted /workspace" "Filesystem mount"
        hostTools -> taskWorkspace "Reads and writes task workspace" "Filesystem"
        owner -> artifacts "Materializes and captures task artifacts" "S3 API"
        owner -> gitea "Dispatches an image workflow on a cache miss" "HTTP"
        owner -> handoff "Loads a verified image handoff" "Filesystem"
        gitea -> builder "Assigns a trusted image workflow" "Runner protocol"
        builder -> imageJob "Submits build/cache jobs and polls status" "Authenticated HTTP"
        imageJob -> docker "Builds, pulls, and streams image exports" "Unix socket API"
        imageJob -> handoff "Validates archives and writes handoff index" "Filesystem"
        automation -> edge "Deploys and probes voice service" "CLI/HTTP"
        automation -> gateway "Deploys and probes task policy service" "CLI/HTTP"
        automation -> pi "Checks native conversation service readiness" "CLI/HTTP"
        automation -> telemetry "Checks fresh metrics and traces" "HTTP"
        collector -> docker "Reads disk usage" "Docker API"
        collector -> telemetry "Publishes byte measurements" "NDJSON pipeline"
        edge -> telemetry "Emits metrics and traces" "OTLP"
        gateway -> telemetry "Emits metrics and traces" "OTLP"
        pi -> telemetry "Emits metrics and traces" "OTLP"
        telemetry -> grafana "Supplies operational measurements" "PromQL/Tempo"

    }

    views {
        container awp work-and-review "Durable work, coding sandbox, and knowledge-review state owners" {
            include user browser knowledge edge pi gateway owner productEffects ownerStore taskWorkspace taskVm hostTools graph artifacts
            autoLayout lr
        }

        container awp build-and-operations "Image preparation, deployment evidence, and storage measurements" {
            include operator docker owner gitea builder imageJob handoff taskVm automation edge gateway pi collector telemetry grafana
            autoLayout lr
        }

        dynamic awp delegate-work "A Gondolin-mode task runs in its coding sandbox and returns a result" {
            user -> browser "Requests delegated work"
            browser -> edge "Submits the request"
            edge -> gateway "Passes owner-scoped request"
            gateway -> owner "Creates native task"
            owner -> ownerStore "Writes accepted task state"
            owner -> taskWorkspace "Prepares task working directory"
            owner -> taskVm "Starts isolated VM with resolved image"
            taskVm -> taskWorkspace "Coding tools read and write mounted workspace"
            owner -> ownerStore "Writes bounded progress"
            owner -> artifacts "Captures result artifact"
            owner -> ownerStore "Writes completion or failure result"
            browser -> edge "Polls task board"
            edge -> gateway "Reads owner-scoped task state"
            gateway -> owner "Reads task projection"
            autoLayout lr
        }

        dynamic awp delegate-work-host "A host-mode task uses host coding tools" {
            gateway -> owner "Creates native task"
            owner -> ownerStore "Writes accepted task state"
            owner -> taskWorkspace "Prepares task working directory"
            owner -> hostTools "Runs coding tools on host"
            hostTools -> taskWorkspace "Reads and writes task workspace"
            owner -> artifacts "Captures result artifact"
            owner -> ownerStore "Writes terminal result"
            autoLayout lr
        }

        dynamic awp process-completed-turn "A completed owner turn creates separate product tasks" {
            edge -> gateway "Submits completed-turn work"
            gateway -> owner "Creates journal and classification tasks"
            owner -> ownerStore "Checkpoints each native task"
            owner -> productEffects "Runs each bounded product effect"
            owner -> ownerStore "Writes each result or failure"
            autoLayout lr
        }

        dynamic awp review-knowledge "A journal correction becomes review history" {
            user -> knowledge "Submits a correction or assertion decision"
            knowledge -> gateway "Sends owner-authenticated review command"
            gateway -> graph "Appends review record and updates entry projection"
            knowledge -> gateway "Queries corrected entry"
            gateway -> graph "Reads entry and review state"
            autoLayout lr
        }

        dynamic awp prepare-image "A repository cache miss becomes a task VM image" {
            owner -> gitea "Dispatches workflow for declared source inputs"
            gitea -> builder "Assigns trusted runner job"
            builder -> imageJob "Submits authenticated image job"
            builder -> imageJob "Uploads context for byte count and digest verification"
            imageJob -> docker "Builds and exports requested image"
            imageJob -> handoff "Validates archive and writes handoff"
            owner -> handoff "Verifies and loads image handoff"
            owner -> taskVm "Starts task sandbox using registered image"
            autoLayout lr
        }

        dynamic awp verify-deployment "An operator receives deployment and health evidence" {
            operator -> automation "Requests deployment or verification"
            automation -> edge "Checks readiness and converges voice service"
            automation -> gateway "Checks task policy service"
            edge -> telemetry "Emits runtime measurements"
            automation -> telemetry "Checks fresh telemetry"
            telemetry -> grafana "Supplies health measurements"
            operator -> grafana "Inspects operational view"
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
                stroke #2563eb
            }
            element "Data Store" {
                shape Cylinder
                background #fef3c7
                color #78350f
                stroke #b45309
            }
            element "Software System" {
                background #e5e7eb
                color #1f2937
            }
        }
    }
}
