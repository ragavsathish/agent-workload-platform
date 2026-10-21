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

The repository pins the Dart package `patrol` at 4.10.0 and `patrol_cli` at
4.8.0. The CLI wrapper verifies its installed version. A version-checked patch
works around the 4.10.0 web trace teardown failure; remove the patch when the
upstream runner can retain the required trace without it.

Generated `test_bundle.dart` and `.patrol.env` are ignored and must not be
committed.
