import { captureCognitiveJournal } from "../../dist/digital-twin/runtime/cognitive-journal.js";

const families = [
  {
    id: "command-narration", expected: "none", variants: [
      "Use speech synthesis for the narration.",
      "Please use speech synthesis for the narration.",
      "Can you use speech synthesis for the narration?",
      "Add synthesized speech to the narration.",
    ],
  },
  {
    id: "reported-claim", expected: "none", variants: [
      "A blog claims graph databases solve every memory problem.",
      "According to an article, graph databases solve every memory problem.",
      "I read that an article says graph databases solve every memory problem.",
      "The author argues that graph databases solve every memory problem.",
    ],
  },
  {
    id: "assistant-proposal", expected: "none", variants: [
      "The assistant proposed putting the video inside the app.",
      "The assistant's suggestion was to embed the video in the app.",
      "You suggested that the video should live inside the app.",
      "Putting the video inside the app was the assistant's idea.",
    ],
  },
  {
    id: "separation-thought", expected: "thought", variants: [
      "I think raw observations should remain separate from durable knowledge.",
      "My view is that raw observations should remain separate from durable knowledge.",
      "Raw observations belong apart from durable knowledge because certainty should be earned.",
      "It seems to me that separating raw observations from durable knowledge prevents accidental certainty.",
    ],
  },
  {
    id: "async-thought", expected: "thought", variants: [
      "I suspect asynchronous review will make the feedback loop easier to follow.",
      "I think asynchronous review makes the feedback loop easier to follow.",
      "To me, asynchronous review seems easier to follow than immediate feedback.",
      "Asynchronous review feels like a clearer feedback loop.",
    ],
  },
  {
    id: "private-graph-decision", expected: "decision", variants: [
      "I decided that the knowledge graph will stay private behind the bounded query service.",
      "We will keep the knowledge graph private behind the bounded query service.",
      "The knowledge graph stays private behind the bounded query service.",
      "The decision is to keep the knowledge graph private behind the bounded query service.",
    ],
  },
  {
    id: "audio-link-question", expected: "question", variants: [
      "Which identifier links an audio segment to its browser action?",
      "How is an audio segment linked to the corresponding browser action?",
      "What connects each audio segment with the browser action it describes?",
      "Where is the mapping between an audio segment and its browser action stored?",
    ],
  },
  {
    id: "local-network-goal", expected: "goal", variants: [
      "My goal is for local development to work without the mesh network.",
      "I want local development to work when the mesh network is unavailable.",
      "We aim to make local development independent of the mesh network.",
      "Success means local development still works with no mesh connection.",
    ],
  },
  {
    id: "timed-narration-idea", expected: "idea", variants: [
      "One idea is to attach narration timing to each trace step.",
      "We could attach narration timing directly to each trace step.",
      "Perhaps every trace step could carry its own narration interval.",
      "A per-step narration interval might keep audio synchronized with the trace.",
    ],
  },
  {
    id: "evidence-learning", expected: "learning", variants: [
      "I learned that exact evidence quotes prevent unsupported memories.",
      "I now understand that exact evidence quotes prevent unsupported memories.",
      "I realized exact evidence quotes are what prevent unsupported memories.",
      "It makes sense now that unsupported memories are prevented by exact evidence quotes.",
    ],
  },
];

async function predict(transcript, id) {
  const capture = await captureCognitiveJournal(transcript, {
    id: `paraphrase-${id}`,
    sourceRef: `journal-paraphrase:${id}`,
  });
  const labels = [...new Set(capture.entries.map((entry) => entry.type))].sort();
  return labels.length === 0 ? "none" : labels.length === 1 ? labels[0] : "multiple";
}

const details = [];
function errorCost(expected, predicted) {
  if (predicted === expected) return 0;
  if (expected === "none" && predicted !== "none") return 5;
  if (expected !== "none" && predicted === "none") return 1;
  return 0.25;
}

for (const family of families) {
  const predictions = [];
  for (const [index, transcript] of family.variants.entries()) {
    predictions.push({ transcript, label: await predict(transcript, `${family.id}-${index + 1}`) });
  }
  const histogram = Object.fromEntries([...new Set(predictions.map(({ label }) => label))]
    .map((label) => [label, predictions.filter((prediction) => prediction.label === label).length]));
  const labels = [...new Set([family.expected, ...predictions.map(({ label }) => label)])];
  const means = Object.fromEntries(labels.map((label) => [
    label,
    predictions.filter((prediction) => prediction.label === label).length / predictions.length,
  ]));
  const biasSquared = labels.reduce((sum, label) => {
    const target = label === family.expected ? 1 : 0;
    return sum + ((means[label] - target) ** 2);
  }, 0) / 2;
  const variance = labels.reduce((sum, label) => sum + means[label] * (1 - means[label]), 0) / 2;
  details.push({
    id: family.id,
    expected: family.expected,
    accuracy: predictions.filter(({ label }) => label === family.expected).length / predictions.length,
    biasSquared,
    variance,
    meanWeightedErrorCost: predictions.reduce(
      (sum, prediction) => sum + errorCost(family.expected, prediction.label),
      0,
    ) / predictions.length,
    histogram,
    predictions,
  });
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
console.log(JSON.stringify({
  summary: {
    families: details.length,
    variants: details.reduce((sum, family) => sum + family.predictions.length, 0),
    meanAccuracy: average(details.map((family) => family.accuracy)),
    meanBiasSquared: average(details.map((family) => family.biasSquared)),
    meanParaphraseVariance: average(details.map((family) => family.variance)),
    meanWeightedErrorCost: average(details.map((family) => family.meanWeightedErrorCost)),
    invariantFamilies: details.filter((family) => Object.keys(family.histogram).length === 1).length,
    sensitiveFamilies: details.filter((family) => Object.keys(family.histogram).length > 1).length,
  },
  details,
}, null, 2));
