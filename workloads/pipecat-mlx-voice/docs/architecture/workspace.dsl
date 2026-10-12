workspace {
    name "Agent Workload Platform · Pipecat MLX Voice"
    description "C4 model for the private browser voice interface and durable Pi workload execution."

    model {
        user = person "Tailnet User" "Talks to Pi, sees Mermaid responses, and explicitly approves work."

        platform = softwareSystem "Agent Workload Platform with Voice" "Private Pipecat voice interface, durable task coordination, and sandboxed tools." {
            browser = container "Browser Client" "Captures microphone audio, renders visual responses, and plays speech." "Safari/React" {
                tags "Client"
            }
            ingress = container "Tailnet Ingress" "Authenticates tailnet devices and forwards the private voice session." "Tailscale Serve" {
                tags "Security"
            }
            edge = container "Voice Edge" "Validates the browser session and runs the Pipecat voice pipeline." "Python/FastAPI/Pipecat" {
                tags "Pipecat"

                transport = component "SmallWebRTCTransport" "Moves browser microphone and speaker frames." "Pipecat transport" {
                    tags "Pipecat"
                }
                vad = component "SileroVADAnalyzer" "Detects speech boundaries for turn processing." "Pipecat VAD" {
                    tags "Pipecat"
                }
                stt = component "OpenAISTTService" "Adapts the OpenAI-compatible STT API." "Pipecat service adapter" {
                    tags "Pipecat"
                }
                context = component "LLMContextAggregatorPair" "Maintains the active user and assistant turn context." "Pipecat processor" {
                    tags "Pipecat"
                }
                llm = component "OpenAILLMService" "Adapts the OpenAI-compatible chat API." "Pipecat service adapter" {
                    tags "Pipecat"
                }
                visual = component "VoiceVisualResponseProcessor" "Splits model JSON into spoken text and Mermaid UI events." "Application component" {
                    tags "Application"
                }
                tts = component "OpenAITTSService" "Adapts the OpenAI-compatible TTS API." "Pipecat service adapter" {
                    tags "Pipecat"
                }
                taskFunctions = component "Task lifecycle functions" "Expose propose, status, approve, and cancel as bounded functions." "Application functions" {
                    tags "Application"
                }

                transport -> vad "Sends audio frames"
                transport -> stt "Sends audio frames"
                vad -> context "Signals speech boundaries"
                stt -> context "Sends transcription frames"
                context -> llm "Sends user turns"
                llm -> visual "Sends model response JSON"
                visual -> tts "Sends spoken field"
                llm -> taskFunctions "Invokes task functions"
            }
            broker = container "Inference Broker" "Provides bounded STT, chat, and TTS model execution." "Native FastAPI · MLX Whisper · Ollama · MLX/Kokoro" {
                tags "HostOnly"
            }
            gateway = container "Agent Gateway" "Applies identity-bound propose, status, approve, and cancel transitions." "FastAPI" {
                tags "Security"
            }
            taskStore = container "Durable Task Store" "Stores proposals, plan hashes, tasks, checkpoints, and results." "Postgres · Absurd" {
                tags "Database"
            }
            artifacts = container "Artifact Store" "Stores immutable workspace bundles and task result patches." "S3Mock · Docker volume" {
                tags "Database"
            }
            observability = container "Observability" "Receives low-cardinality metrics and traces from the voice services." "Grafana OTEL-LGTM · OTLP/HTTP" {
                tags "Observability"
            }
            piVoice = container "Native Pi Voice" "Runs the persistent Pi voice RPC service, maintains the owner-visible transcript, and invokes Gondolin tools." "Native Node.js · Pi" {
                tags "HostOnly"
            }
            worker = container "Pi Worker" "Consumes approved work and runs one durable Pi session per task." "Native Python · Pi" {
                tags "HostOnly"
            }
            gondolin = container "Gondolin Tool Runtime" "Invoked by the Pi extension; runs browser and workspace tools inside isolated micro-VMs. It is not a standalone daemon." "Gondolin micro-VM MCP" {
                tags "Sandbox"
            }
            wassette = container "Wassette Runtime" "Invoked by the Pi extension; provides permission-scoped integration components. It is not a standalone daemon." "Wasm MCP runtime" {
                tags "Sandbox"
            }
        }

        tailscale = softwareSystem "Tailscale Control Plane" "Authenticates devices and distributes tailnet configuration."
        ollama = softwareSystem "Ollama" "Runs the locally approved conversational model on the Mac."
        modelProviders = softwareSystem "Model Providers" "Serve Pi's selected agent model using provider credentials."
        github = softwareSystem "GitHub" "Optional repository API reached through scoped integration tools."

        user -> browser "Uses" "Microphone, speaker, and visual UI"
        browser -> ingress "Loads and streams the private voice session" "Tailnet HTTPS + WebRTC"
        ingress -> tailscale "Obtains device authorization and network configuration" "Tailscale control protocol"
        ingress -> edge "Forwards authenticated voice traffic" "Shared loopback"
        edge -> browser "Returns speech and Mermaid visual events" "WebRTC"
        edge -> broker "Requests bounded STT, chat, and TTS inference" "Bearer-authenticated HTTP"
        edge -> gateway "Proposes, reads, approves, and cancels tasks" "Bearer-authenticated HTTP"
        edge -> observability "Exports metrics and traces" "OTLP/HTTP"
        broker -> ollama "Requests local chat completions" "Loopback OpenAI-compatible HTTP"
        broker -> piVoice "Routes Pi voice turns and transcript requests" "Loopback HTTP"
        broker -> observability "Exports metrics and traces" "OTLP/HTTP"
        gateway -> taskStore "Applies identity-bound task transitions" "Private SQL"
        gateway -> artifacts "Stores and retrieves immutable task artifacts" "S3-compatible HTTP"
        gateway -> observability "Exports metrics and traces" "OTLP/HTTP"
        worker -> taskStore "Consumes approved work and checkpoints results" "Absurd/Postgres"
        worker -> artifacts "Materializes inputs and uploads result patches" "S3-compatible HTTP"
        worker -> modelProviders "Requests Pi agent completions" "Provider API"
        worker -> gondolin "Invokes isolated browser and workspace tools" "Pi extension + MCP"
        worker -> wassette "Invokes permission-scoped integrations" "Pi extension + MCP"
        piVoice -> gondolin "Invokes isolated voice-agent tools" "Pi extension + MCP"
        wassette -> github "Reads or changes repositories when authorized" "Scoped HTTPS"

        local = deploymentEnvironment "Local macOS" {
            mac = deploymentNode "Apple Silicon Mac" "Developer workstation" "macOS" {
                docker = deploymentNode "Docker Desktop Linux VM" "Container runtime" "Docker" {
                    containerInstance ingress
                    containerInstance edge
                    containerInstance gateway
                    containerInstance taskStore
                    containerInstance artifacts
                    containerInstance observability
                }
                host = deploymentNode "Native macOS services" "Host-only MLX and Pi capabilities; Gondolin and Wassette run as child runtimes, not services" "macOS + one LaunchAgent supervisor" {
                    containerInstance broker
                    containerInstance piVoice
                    containerInstance worker
                    containerInstance gondolin
                    containerInstance wassette
                }
            }
        }
    }

    views {
        systemContext platform "context" {
            include user
            include platform
            include tailscale
            include ollama
            include modelProviders
            include github
            autoLayout lr
            title "System Context · Private Voice Interface"
        }

        container platform "containers" {
            include *
            autoLayout lr
            title "Containers · Voice and Durable Pi Workloads"
        }

        component edge "pipecat" {
            include *
            autoLayout tb
            title "Components · Pipecat Voice Edge"
        }

        deployment platform local "deployment" {
            include *
            autoLayout lr
            title "Deployment · Local macOS"
        }

        dynamic platform "voice-turn" {
            title "Dynamic · One Voice Turn"
            1: user -> browser "Speaks and listens"
            2: browser -> ingress "Streams authenticated WebRTC audio"
            3: ingress -> edge "Forwards the session"
            4: edge -> broker "Transcribes audio and routes chat/TTS"
            5: broker -> piVoice "Sends the normalized turn to Pi"
            6: piVoice -> broker "Returns Pi response and transcript state"
            7: edge -> browser "Returns speech and Mermaid event"
            autoLayout lr
        }

        dynamic platform "approved-task" {
            title "Dynamic · Approved Task Execution"
            1: user -> browser "Approves the exact plan"
            2: browser -> ingress "Sends authenticated approval"
            3: ingress -> edge "Forwards approval"
            4: edge -> gateway "Approves the plan hash"
            5: gateway -> taskStore "Enqueues durable work"
            6: worker -> taskStore "Consumes and checkpoints the task"
            7: worker -> gondolin "Runs isolated tools"
            8: worker -> artifacts "Uploads result patch"
            autoLayout lr
        }

        styles {
            element "Person" {
                background #084c8d
                color #ffffff
                shape Person
            }
            element "Software System" {
                background #6b7280
                color #ffffff
            }
            element "Container" {
                background #dbeafe
                color #0f172a
            }
            element "Client" {
                background #bfdbfe
            }
            element "Security" {
                background #dcfce7
                color #14532d
            }
            element "Database" {
                background #fef3c7
                color #78350f
                shape Cylinder
            }
            element "Observability" {
                background #e0e7ff
                color #312e81
            }
            element "Pipecat" {
                background #dbeafe
                color #0f172a
                border solid
            }
            element "Application" {
                background #dcfce7
                color #14532d
            }
            element "HostOnly" {
                background #ede9fe
                color #4c1d95
            }
            element "Sandbox" {
                background #fee2e2
                color #7f1d1d
            }
            relationship "Relationship" {
                color #475569
                thickness 2
                routing Curved
            }
        }
    }
}
