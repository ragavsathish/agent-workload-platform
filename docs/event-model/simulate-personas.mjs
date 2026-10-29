#!/usr/bin/env node
/** Synthetic stakeholder decisions followed by deterministic event replay. */
import assert from 'node:assert/strict';
import { ParallelLedger, events, simulate } from './simulate-parallel-sources.mjs';

const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const model = process.env.PERSONA_MODEL ?? 'qwen3.5:4b-mlx';
const runs = Number(process.argv[2] ?? 100);
if (!Number.isInteger(runs) || runs < 1 || runs > 10000) throw new Error('runs must be 1..10000');

const scenarios = [
  {
    id: 'clean-change',
    evidence: {
      reviewedFinding: true, duplicateChange: false,
      imageRefMatches: true, taskResultCaptured: true,
      oracleQualified: true, behaviorChecksPassed: true,
      lyricManifestGroundedInDiff: true, lyricsContainPrivateData: false,
      prSoundtrackPinned: true, rollbackDocumented: true,
    },
  },
  {
    id: 'failed-behavior-check',
    evidence: {
      reviewedFinding: true, duplicateChange: false,
      imageRefMatches: true, taskResultCaptured: true,
      oracleQualified: true, behaviorChecksPassed: false,
      lyricManifestGroundedInDiff: true, lyricsContainPrivateData: false,
      prSoundtrackPinned: true, rollbackDocumented: true,
    },
  },
];

const personas = [
  { id: 'owner', role: 'AWP product owner', question: 'Is this reviewed, nonduplicate finding ready to become one improvement task?',
    keys: ['reviewedFinding', 'duplicateChange'],
    guard: (e) => e.reviewedFinding && !e.duplicateChange },
  { id: 'runtime', role: 'Gondolin runtime maintainer', question: 'Can this task use the registered image handoff and captured result?',
    keys: ['imageRefMatches', 'taskResultCaptured'],
    guard: (e) => e.imageRefMatches && e.taskResultCaptured },
  { id: 'qualification', role: 'behavior qualification reviewer', question: 'Can this result be qualified when the oracle and behavior checks are considered?',
    keys: ['oracleQualified', 'behaviorChecksPassed'],
    guard: (e) => e.oracleQualified && e.behaviorChecksPassed },
  { id: 'lyrics', role: 'PR lyric reviewer', question: 'Can the lyrics be approved for this diff?',
    keys: ['lyricManifestGroundedInDiff', 'lyricsContainPrivateData'],
    guard: (e) => e.lyricManifestGroundedInDiff && !e.lyricsContainPrivateData },
  { id: 'release', role: 'release operator', question: 'Should this change be approved for release given the complete evidence, pinned soundtrack, and rollback?',
    keys: ['oracleQualified', 'behaviorChecksPassed', 'prSoundtrackPinned', 'rollbackDocumented'],
    guard: (e) => e.oracleQualified && e.behaviorChecksPassed && e.prSoundtrackPinned && e.rollbackDocumented },
];

async function ask(persona, scenario) {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({
      model, stream: false, think: false, format: 'json',
      options: { temperature: 0.2, num_predict: 180 },
      messages: [
        { role: 'system', content: `You are the ${persona.role} in a synthetic AWP EventStorming simulation. Decide only from the supplied evidence. Approve when your stated conditions are met; otherwise hold. Return JSON with decision ("approve" or "hold") and a brief reason. Do not invent facts.` },
        { role: 'user', content: JSON.stringify({ question: persona.question,
          evidence: Object.fromEntries(persona.keys.map((key) => [key, scenario.evidence[key]])) }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${await response.text()}`);
  const data = await response.json();
  let answer;
  try { answer = JSON.parse(data.message?.content ?? ''); }
  catch { throw new Error(`${persona.id} returned non-JSON content`); }
  if (!['approve', 'hold'].includes(answer.decision) || typeof answer.reason !== 'string') {
    throw new Error(`${persona.id} returned invalid decision`);
  }
  return { persona: persona.id, decision: answer.decision, reason: answer.reason,
    guardPassed: Boolean(persona.guard(scenario.evidence)),
    admitted: answer.decision === 'approve' && persona.guard(scenario.evidence) };
}

function selectedEvents(decisions, evidence) {
  const decision = (id) => decisions.find((item) => item.persona === id).admitted;
  const ids = new Set(events.filter((value) => ['knowledge', 'alert'].includes(value.streamId)).map((value) => value.eventId));
  if (!decision('owner')) return events.filter((value) => ids.has(value.eventId));
  for (const id of ['task:1', 'task:2', 'task:3', 'image:1']) ids.add(id);
  if (!decision('runtime')) return events.filter((value) => ids.has(value.eventId));
  for (const id of ['image:2', 'task:4', 'task:5', 'measurement:1']) ids.add(id);
  if (evidence.behaviorChecksPassed) ids.add('measurement:2');
  if (!decision('qualification')) return events.filter((value) => ids.has(value.eventId));
  for (const id of ['qualification:1', 'pr:1', 'lyricTask:1', 'lyricTask:2']) ids.add(id);
  if (!decision('lyrics')) return events.filter((value) => ids.has(value.eventId));
  for (const id of ['lyricTask:3', 'renderTask:1', 'renderTask:2', 'pr:2']) ids.add(id);
  if (decision('release')) for (const id of ['release:1', 'release:2', 'release:3']) ids.add(id);
  return events.filter((value) => ids.has(value.eventId));
}

const report = { kind: 'synthetic LLM persona event-source simulation', model, runsPerScenario: runs, scenarios: [] };
for (const scenario of scenarios) {
  const decisions = await Promise.all(personas.map((persona) => ask(persona, scenario)));
  const selected = selectedEvents(decisions, scenario.evidence);
  const reference = new ParallelLedger();
  for (const value of selected) reference.ingest(value);
  const expected = reference.projection();
  for (let seed = 1; seed <= runs; seed++) {
    const result = simulate(seed, selected);
    assert.deepEqual(result.projection, expected, `${scenario.id} diverged at seed ${seed}`);
  }
  if (!scenario.evidence.behaviorChecksPassed) assert.equal(expected.releaseReady, false);
  report.scenarios.push({ id: scenario.id, evidence: scenario.evidence, decisions,
    emittedEventIds: selected.map((value) => value.eventId),
    converged: runs, finalProjection: expected });
}
console.log(JSON.stringify(report, null, 2));
