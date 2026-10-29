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

**Task Request**:
An owner's intent to delegate one bounded unit of work. Repeating the same request after an uncertain response refers to the same Agent Task; a deliberate new task is a new request.
_Avoid_: Job submission, duplicate task

**Tasking Context**:
The bounded context that submits durable work directly to Pi Durable and owns
task status, cancellation, and artifacts. It receives completed text, never live audio.
_Avoid_: Orchestrator, job backend

**Agent Task**:
Durable work submitted to Pi Durable and executed separately from the active
voice session.
_Avoid_: Job, voice command

**Task Gateway**:
The authenticated product service that forwards direct task submissions and
provides cancellation, status, and bounded result access.
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

**Classification Decision**:
A model-produced label and probability distribution about source evidence, with model provenance; it
is not itself a claim about the owner.
_Avoid_: Assertion, fact, candidate claim

**Review Event**:
An append-only record of an owner accepting, rejecting, correcting, or otherwise reviewing a journal
entry or candidate assertion.
_Avoid_: Status field, classifier decision

**Daily Journal**:
A date- and timezone-scoped document generated from source session evidence; structured journal
entries are its canonical content and any Markdown page is a presentation artifact.
_Avoid_: Transcript, source session

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
