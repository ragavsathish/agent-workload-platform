# Patrol web journeys

The Patrol suite exercises the production Flutter widget tree and `VoiceApi`
through observable UI behavior. Patrol owns the Flutter test binding, so tests
pump `VoiceAgentApp` rather than calling the production `main()` function.

Tests describe user behavior directly and keep repeated browser interactions in
small, named helper functions. Assertions stay beside the behavior they verify
so Patrol reports the failing interaction and expectation without an additional
command/event/reducer layer.

The workspace journey talks to the external fixture server through the real
HTTP client. The fixture keeps domain transitions in
`tool/patrol_fixture_domain.clj`; `tool/patrol_fixture_server.clj` owns HTTP,
timers, and process lifecycle. Each run receives an OS-assigned port and a
nonce-verified health endpoint so concurrent runs cannot share fixture state.
When `GONDOLIN_COMPOSE_PROFILE=full-mock`, a separate live-edge journey uses
the same production widget tree and `VoiceApi`. Its loopback relay forwards
only the typed turn to the running Compose voice-edge with the edge's local
ingress headers and a unique W3C trace ID. Other read endpoints stay on a
fresh fixture state so the browser can render a stable transcript. The relay
records the real edge response in that transcript; Oracle verifies the edge
application span in Tempo under the same trace ID.
The relay uses HTTP/1.1 for the edge POST because Java's default cleartext
HTTP/2 upgrade request is rejected by this Uvicorn endpoint. Set
`PATROL_LIVE_ONLY=true` to run just this third journey while diagnosing it;
the full-mock Oracle qualification uses all three journeys.

The repository pins the Dart package `patrol` at 4.10.0 and `patrol_cli` at
4.8.0. The CLI wrapper verifies its installed version. A version-checked patch
works around the 4.10.0 web trace teardown failure; remove the patch when the
upstream runner can retain the required trace without it.

Generated `test_bundle.dart` and `.patrol.env` are ignored and must not be
committed.
