import { captureCognitiveJournal } from "../../dist/digital-twin/runtime/cognitive-journal.js";

const repetitions = Number.parseInt(process.env.JOURNAL_EVAL_REPETITIONS ?? "3", 10);
if (!Number.isInteger(repetitions) || repetitions < 2 || repetitions > 10) {
  throw new Error("JOURNAL_EVAL_REPETITIONS must be an integer between 2 and 10");
}

const cases = [
  { id: "cmd-01", group: "command", expected: "none", transcript: "Inspect the latest trace and summarize it." },
  { id: "cmd-02", group: "command", expected: "none", transcript: "Restart the listener after rebuilding it." },
  { id: "cmd-03", group: "command", expected: "none", transcript: "Query the graph for my recent notes." },
  { id: "cmd-04", group: "command", expected: "none", transcript: "Read the deployment configuration." },
  { id: "cmd-05", group: "command", expected: "none", transcript: "Create a slide explaining the failed request." },
  { id: "cmd-06", group: "command", expected: "none", transcript: "Use speech synthesis for the narration." },
  { id: "noise-01", group: "noise", expected: "none", transcript: "Voice session connected." },
  { id: "noise-02", group: "noise", expected: "none", transcript: "That works, thanks." },
  { id: "noise-03", group: "noise", expected: "none", transcript: "Go ahead." },
  { id: "noise-04", group: "noise", expected: "none", transcript: "Done for now." },
  { id: "quote-01", group: "reported", expected: "none", transcript: "A blog claims graph databases solve every memory problem." },
  { id: "quote-02", group: "reported", expected: "none", transcript: "My colleague believes all tests should be end to end." },
  { id: "quote-03", group: "reported", expected: "none", transcript: "The presenter explained that event sourcing is scalable." },
  { id: "quote-04", group: "reported", expected: "none", transcript: "The assistant proposed putting the video inside the app." },
  { id: "bio-01", group: "biography", expected: "none", transcript: "I live in Espoo." },
  { id: "bio-02", group: "biography", expected: "none", transcript: "I am an engineering manager." },
  { id: "consume-01", group: "consumption", expected: "none", transcript: "I read an article about temporal databases." },
  { id: "consume-02", group: "consumption", expected: "none", transcript: "I attended a conference session about observability." },

  { id: "thought-01", group: "explicit", expected: "thought", transcript: "I suspect asynchronous review will make the feedback loop easier to follow." },
  { id: "thought-02", group: "implicit", expected: "thought", transcript: "To me, a slide sequence seems easier to inspect than a continuous recording." },
  { id: "thought-03", group: "implicit", expected: "thought", transcript: "Keeping raw observations separate from durable knowledge reduces accidental certainty." },
  { id: "idea-01", group: "explicit", expected: "idea", transcript: "One idea is to attach narration timing directly to each trace step." },
  { id: "idea-02", group: "explicit", expected: "idea", transcript: "Perhaps we could rank captured steps using console errors and failed requests." },
  { id: "idea-03", group: "implicit", expected: "idea", transcript: "A side-by-side view of the DOM snapshot and network call could make debugging faster." },
  { id: "question-01", group: "explicit", expected: "question", transcript: "Why does the service create a second session when the client reconnects?" },
  { id: "question-02", group: "explicit", expected: "question", transcript: "How can the trace viewer preserve annotations when its source archive changes?" },
  { id: "question-03", group: "explicit", expected: "question", transcript: "Which identifier links an audio segment to the corresponding browser action?" },
  { id: "decision-01", group: "explicit", expected: "decision", transcript: "I have decided to store generated videos outside the interactive app." },
  { id: "decision-02", group: "explicit", expected: "decision", transcript: "We will expose local ingress only on the loopback interface." },
  { id: "decision-03", group: "implicit", expected: "decision", transcript: "The knowledge graph stays private behind the bounded query service." },
  { id: "goal-01", group: "explicit", expected: "goal", transcript: "I aim to make trace explanations useful without requiring the original test runner." },
  { id: "goal-02", group: "explicit", expected: "goal", transcript: "We want local development to work when the mesh network is unavailable." },
  { id: "goal-03", group: "implicit", expected: "goal", transcript: "Success means a developer can find the failing interaction in under a minute." },
  { id: "learning-01", group: "explicit", expected: "learning", transcript: "I learned that Playwright stores DOM snapshots separately from screenshots." },
  { id: "learning-02", group: "explicit", expected: "learning", transcript: "It now makes sense that exact source quotes prevent unsupported memories." },
  { id: "learning-03", group: "explicit", expected: "learning", transcript: "I found out that the trace archive already contains network timing information." },
  { id: "mixed-01", group: "mixed", expected: "idea", transcript: "System authenticated. One idea is to group repeated requests into a single trace slide." },
  { id: "mixed-02", group: "mixed", expected: "decision", transcript: "Voice session connected. We will keep narration optional for every slide." },
  { id: "mixed-03", group: "mixed", expected: "learning", transcript: "Assistant reported completion. I realized the journal needs provenance even when it is not accepted knowledge." },
];

async function predict(item, repetition) {
  try {
    const capture = await captureCognitiveJournal(item.transcript, {
      id: `bias-variance-${repetition}-${item.id}`,
      sourceRef: `journal-bias-variance:${repetition}:${item.id}`,
    });
    const types = [...new Set(capture.entries.map((entry) => entry.type))].sort();
    return {
      label: types.length === 0 ? "none" : types.length === 1 ? types[0] : "multiple",
      types,
      entries: capture.entries.map(({ id: _id, ...entry }) => entry),
    };
  } catch (error) {
    return { label: "error", types: [], error: error instanceof Error ? error.message : String(error) };
  }
}

const observations = new Map(cases.map((item) => [item.id, []]));
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  const rotated = cases.slice(repetition - 1).concat(cases.slice(0, repetition - 1));
  for (const item of rotated) {
    observations.get(item.id).push(await predict(item, repetition));
  }
}

function errorCost(expected, predicted) {
  if (predicted === expected) return 0;
  if (predicted === "error" || (expected === "none" && predicted !== "none")) return 5;
  if (expected !== "none" && predicted === "none") return 1;
  return 0.25;
}

const labels = ["none", "thought", "idea", "question", "decision", "goal", "learning", "unclassified", "multiple", "error"];
const details = cases.map((item) => {
  const predictions = observations.get(item.id);
  const histogram = Object.fromEntries(labels
    .map((label) => [label, predictions.filter((prediction) => prediction.label === label).length])
    .filter(([, count]) => count > 0));
  const mean = Object.fromEntries(labels.map((label) => [label, (histogram[label] ?? 0) / repetitions]));
  const biasSquared = labels.reduce((sum, label) => {
    const target = label === item.expected ? 1 : 0;
    return sum + ((mean[label] - target) ** 2);
  }, 0) / 2;
  const variance = labels.reduce((sum, label) => sum + mean[label] * (1 - mean[label]), 0) / 2;
  return {
    ...item,
    histogram,
    accuracy: predictions.filter((prediction) => prediction.label === item.expected).length / repetitions,
    biasSquared,
    variance,
    sampleEntries: predictions.find((prediction) => prediction.entries?.length)?.entries ?? [],
  };
});

const runs = Array.from({ length: repetitions }, (_, index) => {
  const predictions = cases.map((item) => ({ item, prediction: observations.get(item.id)[index] }));
  const positives = predictions.filter(({ item }) => item.expected !== "none");
  const negatives = predictions.filter(({ item }) => item.expected === "none");
  const extracted = predictions.filter(({ prediction }) => prediction.label !== "none" && prediction.label !== "error");
  return {
    repetition: index + 1,
    accuracy: predictions.filter(({ item, prediction }) => item.expected === prediction.label).length / cases.length,
    negativeRejectionRate: negatives.filter(({ prediction }) => prediction.label === "none").length / negatives.length,
    positiveTypeRecall: positives.filter(({ item, prediction }) => item.expected === prediction.label).length / positives.length,
    extractionPrecision: extracted.length === 0 ? 1 : extracted.filter(({ item, prediction }) => item.expected === prediction.label).length / extracted.length,
    meanWeightedErrorCost: predictions.reduce(
      (sum, { item, prediction }) => sum + errorCost(item.expected, prediction.label),
      0,
    ) / predictions.length,
    errors: predictions.filter(({ prediction }) => prediction.label === "error").length,
  };
});

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
console.log(JSON.stringify({
  summary: {
    cases: cases.length,
    repetitions,
    observations: cases.length * repetitions,
    meanAccuracy: average(runs.map((run) => run.accuracy)),
    meanNegativeRejectionRate: average(runs.map((run) => run.negativeRejectionRate)),
    meanPositiveTypeRecall: average(runs.map((run) => run.positiveTypeRecall)),
    meanExtractionPrecision: average(runs.map((run) => run.extractionPrecision)),
    meanWeightedErrorCost: average(runs.map((run) => run.meanWeightedErrorCost)),
    meanBiasSquared: average(details.map((item) => item.biasSquared)),
    meanVariance: average(details.map((item) => item.variance)),
    systematicErrorCases: details.filter((item) => item.accuracy === 0).length,
    unstableCases: details.filter((item) => Object.keys(item.histogram).length > 1).length,
  },
  runs,
  systematicErrors: details.filter((item) => item.accuracy === 0),
  unstable: details.filter((item) => Object.keys(item.histogram).length > 1),
  details,
}, null, 2));
