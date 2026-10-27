import assert from "node:assert/strict";
import test from "node:test";

import { cognitiveJournalSparql } from "../../dist/digital-twin/runtime/cognitive-journal.js";

test("journal RDF uses typed journal concepts and PROV lineage", () => {
  const id = "a".repeat(32);
  const update = cognitiveJournalSparql({
    id,
    sourceRef: "pi-session:test-session:message:test-message",
    capturedAt: "2026-10-27T10:00:00.000Z",
    transcript: "I decided to keep source evidence separate from accepted facts.",
    entries: [{
      id: `${id}:entry:1`,
      type: "decision",
      text: "Keep source evidence separate from accepted facts.",
      topics: ["provenance"],
    }],
  });

  assert.match(update, /a schema:Message, prov:Entity/);
  assert.match(update, /a schema:CreativeWork, pk:JournalEntry, prov:Entity/);
  assert.match(update, /pk:journalEntryKind <urn:voice-agent:personal-knowledge:concept:journal-kind:decision>/);
  assert.match(update, /prov:wasDerivedFrom <urn:pk:digital-twin:journal:/);
  assert.match(update, /prov:wasGeneratedBy <urn:pk:digital-twin:activity:journal:/);
  assert.match(update, /prov:used <urn:pk:digital-twin:journal:/);
  assert.match(update, /prov:generated <urn:pk:digital-twin:journal:/);
  assert.match(update, /\^\^xsd:dateTimeStamp/);
});

test("journal RDF activity is valid when extraction yields no entries", () => {
  const id = "b".repeat(32);
  const update = cognitiveJournalSparql({
    id,
    sourceRef: "pi-session:test-session:message:test-message",
    capturedAt: "2026-10-27T10:00:00.000Z",
    transcript: "I have been thinking about provenance and evidence.",
    entries: [],
  });

  assert.match(update, /<urn:pk:digital-twin:activity:journal:[a-f0-9]{32}> a prov:Activity/);
  assert.match(update, /prov:used <urn:pk:digital-twin:journal:/);
  assert.doesNotMatch(update, /prov:generated/);
});
