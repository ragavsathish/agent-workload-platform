import assert from "node:assert/strict";
import test from "node:test";

import {
  completedOwnerTurns,
  enqueueTurn,
} from "../../dist/digital-twin/runtime/session-listener.js";

test("listener emits only owner turns followed by a completed assistant message", () => {
  const entries = [
    {
      type: "message",
      id: "user-1",
      parentId: null,
      timestamp: "2026-10-17T10:00:00Z",
      message: { role: "user", content: "I think bounded writers are safer.", timestamp: 1 },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "user-1",
      timestamp: "2026-10-17T10:00:01Z",
      message: { role: "assistant", content: [{ type: "text", text: "Agreed." }], timestamp: 2 },
    },
    {
      type: "message",
      id: "user-pending",
      parentId: "assistant-1",
      timestamp: "2026-10-17T10:01:00Z",
      message: { role: "user", content: "This turn is still running.", timestamp: 3 },
    },
  ];

  assert.deepEqual(completedOwnerTurns("session-7", entries), [{
    sessionId: "session-7",
    messageId: "user-1",
    transcript: "I think bounded writers are safer.",
    capturedAt: "2026-10-17T10:00:00.000Z",
  }]);
});

test("listener excludes developer bootstrap turns using persisted origin metadata", () => {
  const turns = completedOwnerTurns("session-1", [
    {
      type: "custom",
      id: "origin-1",
      parentId: null,
      timestamp: "2026-10-17T09:59:59.000Z",
      customType: "voice.turn-origin",
      data: { origin: "developer" },
    },
    {
      type: "message",
      id: "bootstrap-1",
      parentId: "origin-1",
      timestamp: "2026-10-17T10:00:00.000Z",
      message: { role: "user", content: "The authenticated user is owner@example.com.", timestamp: 1 },
    },
    {
      type: "message",
      id: "assistant-1",
      parentId: "bootstrap-1",
      timestamp: "2026-10-17T10:00:01.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Voice interface ready." }], timestamp: 2 },
    },
  ]);

  assert.deepEqual(turns, []);
});

test("listener submits the stable Pi session and message identity", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ task_id: "task-1" }), { status: 202 });
  };
  try {
    await enqueueTurn(
      {
        sessionId: "session-7",
        messageId: "message-3",
        transcript: "An idea.",
        capturedAt: "2026-10-17T10:00:00.000Z",
      },
      {
        gatewayBaseUrl: "http://127.0.0.1:9444/v1/",
        gatewayToken: "secret",
        identity: "owner@example.com",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(request.url, "http://127.0.0.1:9444/v1/digital-twin/ingestions");
  assert.equal(request.options.headers.authorization, "Bearer secret");
  assert.deepEqual(JSON.parse(request.options.body), {
    identity: "owner@example.com",
    sessionId: "session-7",
    messageId: "message-3",
    transcript: "An idea.",
    capturedAt: "2026-10-17T10:00:00.000Z",
  });
});
