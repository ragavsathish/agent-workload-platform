# Voice Agent server

The server follows the same layered shape used by the Python DDD workshop,
with each bounded context exposing its own internal layers.

```text
server/
├── src/voice_agent/
│   ├── speech/                 # Speech inference bounded context
│   │   ├── application/        # Transcript interpretation
│   │   ├── infrastructure/     # MLX model adapters
│   │   └── presentation/       # Authenticated inference HTTP API
│   ├── tasking/                # Durable agent-task bounded context
│   │   ├── domain/             # Approval and workspace rules
│   │   ├── application/        # Task lifecycle and Pi response use cases
│   │   ├── infrastructure/     # Postgres, Absurd, S3, and configuration
│   │   ├── presentation/       # HTTP and CLI adapters
│   │   └── workers/            # Durable Pi task consumer
│   └── shared/                 # Small cross-context technical utilities
├── migrations/                 # Server-owned database migrations
└── tests/                      # Mirrors the production layers
```

Domain code points inward and must not import FastAPI, Pydantic, Postgres,
Absurd, S3, MLX, or Pipecat. Presentation stays transport-specific and
infrastructure stays vendor-specific. The current task lifecycle application
service is also the composition seam for its Postgres, Absurd, and artifact
adapters; extracting ports is intentionally deferred until a second adapter or
an isolated application test requires that indirection.

The two contexts deliberately remain separate. Speech inference turns audio
into text and text into audio. Tasking owns durable proposals, approval,
execution, and artifact access. Their deployed processes are composition
roots, not additional domain layers.
