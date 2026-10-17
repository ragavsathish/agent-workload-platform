# Voice Agent

The Voice Agent context owns the private spoken interaction from captured owner
speech through agent response, isolated action, and optional durable delegation.

## Conversation

**Speech Inference Context**:
The bounded context that turns accepted audio into a transcript and response
text into synthesized audio. It does not decide or execute durable work.
_Avoid_: MLX service, voice backend

**Voice Session**:
One active browser conversation whose speech, transcript, Pi context, and audio
responses share a lifetime.
_Avoid_: Call, chat session

**Turn**:
One accepted unit of owner speech and the resulting agent processing cycle.
_Avoid_: Message, audio chunk

**Voice Edge**:
The tailnet-facing process that terminates the browser media session and runs
the Pipecat conversation pipeline.
_Avoid_: Server, backend, bot

**Inference Broker**:
The narrow host capability that exposes Apple-accelerated speech and model
inference without exposing the macOS process or model credentials.
_Avoid_: MLX server, model backend

**Pi Voice Service**:
The persistent owner-only Pi session that turns a completed transcript into a
response or an isolated tool action.
_Avoid_: Pi backend, LLM service

## Durable work

**Tasking Context**:
The bounded context that owns task proposals, approval, durable execution,
status, and task artifacts. It receives completed text, never live audio.
_Avoid_: Orchestrator, job backend

**Task Proposal**:
A durable description of intended agent work that has not yet entered the work
queue.
_Avoid_: Job, draft task

**Agent Task**:
Approved durable work executed separately from the active voice session.
_Avoid_: Proposal, voice command

**Task Gateway**:
The authenticated product service that owns task proposal, approval,
cancellation, status, and bounded result access.
_Avoid_: Agent gateway, API server

**Published Workspace**:
An immutable repository bundle registered as the input to an Agent Task.
_Avoid_: Host mount, current directory

**Task Artifact**:
An immutable output produced by an Agent Task, such as a patch or result
document.
_Avoid_: Transcript, workspace file

## Personal knowledge

**Candidate Assertion**:
An evidence-bound statement derived from owner speech that may describe a conversation topic, skill,
or profile change but has not been accepted as a durable profile fact.
_Avoid_: Fact, memory

**Profile Fact**:
A reviewed, durable statement about the owner retained independently of the conversation that
provided its evidence.
_Avoid_: Candidate assertion, transcript

**Learning Evidence**:
An owner-confirmed interaction with a learning resource that supports an evolving topic-level view
of what the owner is learning without, by itself, asserting mastery.
_Avoid_: Profile fact, skill, watch history

**Source Claim**:
A proposition attributed to a learning resource and retained with its source lineage; it describes
what the source says rather than what the owner necessarily believes or knows.
_Avoid_: Profile fact, ground truth

## Isolation

**Voice Workspace**:
The dedicated writable directory mounted into the persistent Gondolin VM used
by the Pi Voice Service.
_Avoid_: Host workspace, published workspace

**Capability**:
An explicitly granted operation available across an isolation boundary.
_Avoid_: Tool, permission
