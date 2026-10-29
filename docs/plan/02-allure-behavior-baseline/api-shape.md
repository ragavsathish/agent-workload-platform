---
type: reference
title: "API shape baseline"
---

# API shape baseline

**Status:** planned companion to the [behavior baseline](plan.md). Allure journey
results show that calls succeeded; they do not contain a complete, versioned API
schema. Record the wire contract separately and link its checks to Allure.

## What the Playwright trace contains

The pinned run's Playwright ZIP attachments contain `0-trace.network` records and
`resources/` body blobs. No separate `.har` file was found. These records are HAR-like:
each resource snapshot gives method, URL, request and response headers, status, content
type, and a body reference. The body reference can be resolved inside the same ZIP.
The deployed durable result `1b2f2d8b-0c38-4fb3-b69c-10176122134e-result.json` points
to trace `1b2f2d8b-0c38-4fb3-b69c-10176122134e-0-5.zip` under the pinned run's
ignored `allure-results/` directory.

That trace directly observed these browser wire samples:

| Request | Observed response structure |
| --- | --- |
| `GET /api/pi-sessions` | `200` JSON object with `sessions`; a sampled session has `id`, `title`, `updatedAt`, `messageCount`, `active`. |
| `POST /api/pi-message` | Request body has `message`; `200` JSON response has `spoken`, `presentation`, `resourceUri`. |
| `GET /api/tasks` | `200` JSON array; a sampled task has `id`, `identity`, `instruction`, `workspace`, `session_name`, `session_reference`, `plan_hash`, `status`, `task_id`, `created_at`, `expires_at`, `result`. |
| `GET /api/tasks/{id}/progress` | `200` JSON array; a sampled event has `id`, `spoken`, `created_at`. |
| `POST /api/tasks/{id}/narration` | Request body has `after` and `through`; `200` JSON response has `spoken`. |
| `GET /api/tasks/{id}/artifacts/workspace` | `200` binary response; the test separately asserts ZIP media type, attachment disposition, and expected entry content. |

These are **observed fields**, not a declaration that every field is always required.
The deployed journey submits through Pi's tool path, so it does not demonstrate a
browser `POST /api/tasks`. A C2 mock trace does show that route returning `201`, but
that remains fixture evidence. The browser trace also cannot show the private
Gateway-to-Owner HTTP exchange or the Unix socket contract. Inspect the source and
dedicated tests for those boundaries.

The ZIP can contain headers, cookies, prompts, transcript text, task instructions, and
response bodies. A shape extractor must read it locally, emit only allowlisted field
names/types/statuses, and never commit the raw trace, body, query values, or header values.
The [measurement oracle](measurement-oracle.md) should judge that extraction on synthetic
traces before its output is used for the reviewed API golden.

## Boundary to judge

The browser uses the Voice Edge's `/api/...` routes, implemented in
[`apps/edge/bot.py`](../../../products/voice-agent/apps/edge/bot.py) and consumed by the
Flutter [`VoiceApi`](../../../products/voice-agent/apps/client/lib/api_client.dart) and
[`models.dart`](../../../products/voice-agent/apps/client/lib/models.dart). The Edge
supplies the authenticated owner identity when it forwards task operations. The private
Gateway has its own `/v1/...` request shape, including an `identity` field or query
parameter, in [`apps/gateway/src/voice_gateway/main.py`](../../../products/voice-agent/apps/gateway/src/voice_gateway/main.py).
Do not collapse these into one schema: a change to the browser contract can break Flutter
even when Gateway remains compatible, and a Gateway change can weaken authorization
without changing the browser's JSON.

## First contract set

| Surface | Routes to pin | Shape to check |
| --- | --- | --- |
| Browser conversation | `GET /api/pi-sessions`, `POST /api/pi-sessions/new`, `POST /api/pi-sessions/{id}/resume`, `POST /api/pi-message` | Session-list envelope and session fields; message request and `spoken`, `presentation`, `resourceUri` response types; status codes and malformed-input errors. |
| Browser tasks | `GET/POST /api/tasks`, `GET /api/tasks/{id}`, `GET /api/tasks/{id}/progress`, `POST /api/tasks/{id}/narration`, `POST /api/tasks/{id}/cancel` | Required request fields, optional `workspace`, task ID and state fields, progress cursor and event fields, narration response, error envelope, and response status. |
| Browser artifact | `GET /api/tasks/{id}/artifacts/workspace` | `application/zip`, attachment disposition, private/no-store cache headers, nonempty ZIP, and owned-task access. Compare headers and ZIP validity, not the compressed bytes. |
| Private task Gateway | `POST/GET /v1/tasks`, `GET /v1/tasks/{id}`, `GET /v1/tasks/{id}/progress`, `GET /v1/tasks/{id}/artifacts/{name}`, `POST /v1/tasks/{id}/cancel` | Bearer requirement, exact-owner identity, query bounds, public-view projection, artifact headers, and documented 4xx/5xx classes. The Gateway body includes identity; the browser body does not. |

Begin with these routes because the [voice-to-durable slice](../01-voice-to-durable/plan.md)
and the deployed [durable journey](../../../products/voice-agent/tests/e2e/playwright/durable.spec.ts)
exercise them. Extend later to knowledge review, music, diagnostics, MCP tools, WebRTC,
and the Pi Durable socket as separate contracts, each with its own transport and owner.

## Golden format and comparison

Keep a reviewed `docs/baselines/voice-agent/api-shape-v1.json` separate from the
behavior predicates. One entry per method and route template should record:

- boundary (`browser-edge` or `private-gateway`), method, path template, success
  status and media type;
- request fields with requiredness, type, bounds, and enum where applicable;
- response fields with requiredness, type, nullability, and nested structure;
- error status and stable error **shape**, such as `{ "detail": string }`;
- auth/identity rule and security-sensitive response exclusions;
- source code location, contract test, Allure case, and reviewed baseline version.

Normalize route IDs, timestamps, text generated by Pi, task instructions, and artifact
bytes. Preserve exact field names, casing, type, requiredness, status code, content type,
and relevant headers. For security-sensitive task views, explicitly forbid raw Pi events,
legacy approval fields, credentials, and another owner's data; the Gateway's
[`voice_view`](../../../products/voice-agent/apps/gateway/src/voice_gateway/main.py)
already projects a bounded public result, and the existing
[`Gateway tests`](../../../products/voice-agent/apps/gateway/tests/test_gateway.py)
check parts of this contract.

The comparison should report **breaking**, **additive**, and **unjudged** changes rather
than merely hashing JSON. Removing or renaming a consumed field, changing its type,
making an optional request field required, changing a success status or media type, or
relaxing an auth rule is breaking. A new optional field is additive and reviewable; a new
field on a closed, security-sensitive task result is breaking until reviewed. If a route
or required sample is missing, the contract is unjudged, never green.

## How to obtain evidence

1. Derive the route and request model list from the two source boundaries and the Flutter
   client. The Gateway disables its public OpenAPI URL, but its FastAPI app can generate
   a schema in-process. Use that as **one input**, not the whole golden: several routes
   return untyped dictionaries or `Response` objects, so generated OpenAPI cannot state
   every response field or artifact header. Voice Edge routes are registered in its
   `__main__` startup block, so importing `bot.py` alone does not expose their full API.
2. Parse selected Playwright `0-trace.network` records and their referenced body blobs
   into a redacted **observed-shape candidate** for the browser API. Normalize dynamic
   path segments and preserve method, status, media type, field names, and JSON types.
   Cross-check against what Flutter parses. Add focused, fixture-backed contract probes
   for routes and negative cases absent from the deployed trace. Do not infer requiredness
   from one successful response; use the request model and explicit tests.
3. Attach the canonical contract receipt to Allure with the same `validationLayer`
   convention as existing cases. Keep the deployed browser journey as confirmation that
   the contract works through ingress. A fixture contract cannot replace that journey.
4. Review and commit the first API golden. A read-only comparer checks future receipts
   against it, reports the change category and source route, and never updates the
   accepted file automatically.

## Acceptance

- Every v1 route has a method/path identity, a source location, and a checked response
  or explicit `unjudged` status.
- The browser and private Gateway contracts are separate, including their identity
  placement and authorization checks.
- A removed Flutter-consumed field, changed task status, changed artifact media type,
  or exposed raw event fails; a dynamic task ID or ZIP checksum does not.
- A new optional field is reported for review, with a stricter closed-field policy on
  owner-visible task results.
- The API golden is reviewed and versioned independently of the Allure behavior golden.
