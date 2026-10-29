---
type: concept
title: "Interactive voice"
description: The documented route from an accepted spoken turn to the browser response.
sources:
  - resource: ../../../products/voice-agent/docs/architecture/d1-interactive-voice-turn.mmd
    title: Interactive voice turn journey
  - resource: ../../../products/voice-agent/docs/architecture/deployment-security.mmd
    title: Deployment and security view
  - resource: ../../../products/voice-agent/TESTING.md
    title: Voice Agent testing guide
---

# Interactive voice

**Question:** How does one accepted spoken turn become an agent response?

A [Voice Session](../../../products/voice-agent/GLOSSARY.md) gives speech, transcript, Pi
context, and audio responses a shared lifetime. Within it, a **Turn** is one accepted unit
of owner speech and its processing cycle. The [D1 journey](../../../products/voice-agent/docs/architecture/d1-interactive-voice-turn.mmd)
shows the sequence: browser audio enters through tailnet ingress; the Voice Edge applies
input filtering and turn detection; the Inference Broker transcribes; the Pi Voice Service
handles the conversation and may use isolated workspace tools; the edge sends synthesized
speech and presentation data back to the browser.

The [C2 view](../../../products/voice-agent/docs/architecture/c2-container.mmd) separates
the browser, Voice Edge, Inference Broker, and Pi Voice Service because each has a distinct
runtime responsibility. The [deployment view](../../../products/voice-agent/docs/architecture/deployment-security.mmd)
places the inference and Pi services on the Mac and the Voice Edge in Docker. Tool actions
from the voice session cross into the persistent Gondolin voice VM; the browser does not
receive host filesystem or model credentials.

The [testing guide](../../../products/voice-agent/TESTING.md) distinguishes protocol tests
that send synthetic microphone audio through the real WebRTC path from browser tests that
prove visible rendering. `make verify` checks the deployed envelope; a fresh voice journey
is needed to establish that a turn worked. The product's
[architecture index](../../../products/voice-agent/docs/architecture/README.md) maps these
views to code and verification evidence.

**Related decision:** [ADR 0002](../../adr/0002-layer-the-voice-server-by-bounded-context.md)
places the voice entry point and its bounded contexts within the product.
