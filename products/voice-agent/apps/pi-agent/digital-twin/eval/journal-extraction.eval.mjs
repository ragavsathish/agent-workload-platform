import { performance } from "node:perf_hooks";

import { captureCognitiveJournal } from "../../dist/digital-twin/runtime/cognitive-journal.js";

const cases = [
  { id: "n01", expected: null, transcript: "Next" },
  { id: "n02", expected: null, transcript: "Authenticated user: owner@example.com" },
  { id: "n03", expected: null, transcript: "System connected successfully." },
  { id: "n04", expected: null, transcript: "Can you hear me?" },
  { id: "n05", expected: null, transcript: "Please repeat what you said." },
  { id: "n06", expected: null, transcript: "Check broker folder." },
  { id: "n07", expected: null, transcript: "Run actual tests and show the result." },
  { id: "n08", expected: null, transcript: "Open it and check." },
  { id: "n09", expected: null, transcript: "Deploy the app." },
  { id: "n10", expected: null, transcript: "Check OTel for errors." },
  { id: "n11", expected: null, transcript: "Search the web." },
  { id: "n12", expected: null, transcript: "I watched a YouTube talk about domain-driven design." },
  { id: "n13", expected: null, transcript: "The assistant said event sourcing is always best." },
  { id: "n14", expected: null, transcript: "Okay, thank you." },
  { id: "n15", expected: null, transcript: "I work at Example Corporation." },
  { id: "n16", expected: null, transcript: "Use the TTS model for audio." },
  {
    id: "p01",
    expected: "thought",
    transcript: "I think memory should remain separate from accepted facts.",
  },
  {
    id: "p02",
    expected: "idea",
    transcript: "An idea is to present the trace as a sequence of interactive slides.",
  },
  {
    id: "p03",
    expected: "question",
    transcript: "Why does the local ingress route through Tailscale when the caller is on the same machine?",
  },
  {
    id: "p04",
    expected: "decision",
    transcript: "I decided that the MCP app will show slides while video remains a standalone artifact.",
  },
  {
    id: "p05",
    expected: "goal",
    transcript: "My goal is to make most local tests independent of Tailscale.",
  },
  {
    id: "p06",
    expected: "learning",
    transcript: "I learned that Playwright trace snapshots can be rendered without replaying the test.",
  },
  {
    id: "p07",
    expected: "learning",
    transcript: "I realized EventStorming helps a team build a shared model.",
  },
  {
    id: "p08",
    expected: "learning",
    transcript: "I now understand that journal memories should not automatically become accepted profile facts.",
  },
  {
    id: "p09",
    expected: "thought",
    transcript: "I worry that a full video hides the moments a developer actually needs to inspect.",
  },
  {
    id: "p10",
    expected: "idea",
    transcript: "We could synchronize narration by attaching an audio interval to each trace slide.",
  },
  {
    id: "p11",
    expected: "decision",
    transcript: "We will keep Oxigraph private and query it through the bounded reader endpoint.",
  },
  {
    id: "p12",
    expected: "goal",
    transcript: "I want the agent to select the relevant trace automatically and render it in the MCP app.",
  },
  {
    id: "p13",
    expected: "question",
    transcript: "How can a developer compare the network request with the DOM snapshot from the same trace step?",
  },
  {
    id: "p14",
    expected: "learning",
    transcript: "I discovered that exact evidence quotes make false journal memories easier to reject.",
  },
  {
    id: "p15",
    expected: "idea",
    transcript: "A useful approach might be to rank trace steps by errors, network failures, and visual changes.",
  },
  {
    id: "m01",
    expected: "learning",
    transcript: "System connected successfully. I learned that local ingress can bypass Tailscale safely.",
  },
];

async function evaluate(item) {
  const startedAt = performance.now();
  let rawModelOutput;
  try {
    const capture = await captureCognitiveJournal(item.transcript, {
      id: `eval-${item.id}`,
      sourceRef: `journal-eval:${item.id}`,
      fetch: async (...args) => {
        const response = await fetch(...args);
        const payload = await response.clone().json().catch(() => undefined);
        rawModelOutput = payload?.message?.content;
        return response;
      },
    });
    const predicted = capture.entries.map((entry) => entry.type);
    const passed = item.expected === null
      ? predicted.length === 0
      : predicted.includes(item.expected);
    return {
      ...item,
      passed,
      predicted,
      entries: capture.entries.map(({ id: _id, ...entry }) => entry),
      rawModelOutput,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      ...item,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}

const results = [];
for (const item of cases) results.push(await evaluate(item));

const negatives = results.filter((item) => item.expected === null);
const positives = results.filter((item) => item.expected !== null);
const trueNegatives = negatives.filter((item) => item.passed).length;
const truePositives = positives.filter((item) => item.passed).length;
const extractedCases = results.filter((item) => (item.predicted?.length ?? 0) > 0);
const correctlyExtractedCases = extractedCases.filter((item) => item.expected !== null).length;

console.log(JSON.stringify({
  summary: {
    cases: results.length,
    passed: results.filter((item) => item.passed).length,
    accuracy: results.filter((item) => item.passed).length / results.length,
    negativeRejectionRate: trueNegatives / negatives.length,
    positiveTypeRecall: truePositives / positives.length,
    extractionPrecisionProxy: extractedCases.length === 0
      ? 1
      : correctlyExtractedCases / extractedCases.length,
    errors: results.filter((item) => item.error).length,
    totalLatencyMs: results.reduce((sum, item) => sum + item.latencyMs, 0),
  },
  failures: results.filter((item) => !item.passed),
  results,
}, null, 2));
