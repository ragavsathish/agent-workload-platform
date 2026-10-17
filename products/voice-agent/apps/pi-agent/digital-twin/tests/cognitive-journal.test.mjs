import assert from "node:assert/strict";
import test from "node:test";

import {
  captureCognitiveJournal,
  cognitiveJournalSparql,
} from "../../dist/digital-twin/runtime/cognitive-journal.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("cognitive journal captures loosely typed entries with a light source reference", async () => {
  let request;
  const capture = await captureCognitiveJournal(
    "I think memories should remain separate from accepted facts.",
    {
      id: "capture-1",
      sourceRef: "pi-session:session-7:turn-3",
      now: () => new Date("2026-10-17T09:00:00Z"),
      fetch: async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return jsonResponse({
          message: {
            content: JSON.stringify({
              entries: [{
                type: "idea",
                text: "Memories should remain separate from accepted facts.",
                topics: ["digital twins", "memory"],
              }],
            }),
          },
        });
      },
    },
  );

  assert.equal(request.url, "http://127.0.0.1:11434/api/chat");
  assert.match(request.body.messages[0].content, /lightweight cognitive journal/);
  assert.deepEqual(capture.entries, [{
    id: "capture-1:entry:1",
    type: "idea",
    text: "Memories should remain separate from accepted facts.",
    topics: ["digital twins", "memory"],
  }]);
  assert.equal(capture.sourceRef, "pi-session:session-7:turn-3");
});

test("journal SPARQL is append-only, escaped, and keeps provenance light", () => {
  const update = cognitiveJournalSparql({
    id: "capture-1",
    sourceRef: "pi-session:7",
    capturedAt: "2026-10-17T09:00:00.000Z",
    transcript: "I have an \"idea\".\nKeep it simple.",
    entries: [{
      id: "capture-1:entry:1",
      type: "idea",
      text: "Keep the model simple.",
      topics: ["digital twins"],
    }],
  });

  assert.match(update, /INSERT DATA/);
  assert.doesNotMatch(update, /CLEAR|DELETE/);
  assert.match(update, /schema:additionalType "idea"/);
  assert.match(update, /schema:keywords "digital twins"/);
  assert.match(update, /I have an \\"idea\\"\.\\nKeep it simple\./);
  assert.match(update, /schema:isBasedOn/);
});

test("journal SPARQL rejects an unsafe graph identifier", () => {
  assert.throws(
    () => cognitiveJournalSparql({
      id: "capture-1",
      sourceRef: "session",
      capturedAt: "2026-10-17T09:00:00.000Z",
      transcript: "A thought.",
      entries: [],
    }, "http://example.com/> } DELETE WHERE { ?s ?p ?o"),
    /safe URN/,
  );
});
