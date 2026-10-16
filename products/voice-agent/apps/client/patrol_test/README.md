# Patrol web journeys

The Patrol suite exercises the production Flutter widget tree and `VoiceApi`
through observable UI behavior. Patrol owns the Flutter test binding, so tests
pump `VoiceAgentApp` rather than calling the production `main()` function.

Journeys follow the functional DDD decision chain:

```text
command -> Patrol interpreter -> past-tense event -> pure reducer -> policy
```

The interpreter is the imperative shell. Command and event types, immutable
journey state, reducers, and policy validation live under `support/` and do not
perform browser or network effects.

The workspace journey talks to the external fixture server through the real
HTTP client. The fixture keeps domain transitions in
`tool/patrol-fixture-domain.mjs`; `tool/patrol-fixture-server.mjs` owns HTTP,
timers, and process lifecycle. Each run receives an OS-assigned port and a
nonce-verified health endpoint so concurrent runs cannot share fixture state.

The repository pins the Dart package `patrol` at 4.10.0 and `patrol_cli` at
4.8.0. The CLI wrapper verifies its installed version. A version-checked patch
works around the 4.10.0 web trace teardown failure; remove the patch when the
upstream runner can retain the required trace without it.

Generated `test_bundle.dart` and `.patrol.env` are ignored and must not be
committed.
