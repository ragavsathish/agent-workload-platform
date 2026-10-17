# Local judge model research

Research date: 2026-10-17. Scope: a local, non-gating LLM judge for the digital-twin
classifier evaluation in `apps/pi-agent/digital-twin/eval/`, running through LM Studio on an Apple M4 Pro
with 64 GB unified memory. Sources are limited to official model cards, official benchmark
repositories/results, and official LM Studio/OpenAI documentation.

## Recommendation

Use **AtlaAI/Selene-1-Mini-Llama-3.1-8B** as the first model to calibrate for the pointwise
classifier judge. It is the best fit found for this task rather than a claim that it is universally
the best judge:

- it is post-trained specifically for evaluation and supports absolute scoring, classification,
  pairwise preference, structured evaluation output, and qualitative critiques;
- its Llama 3.1 base is independent of Cloudflare Clef's Qwen 3.8 base, avoiding the known
  Qwen-on-Qwen correlation;
- the official Q4_K_M GGUF is 4.92 GB and explicitly lists LM Studio, so it is a low-risk fit for
  the 64 GB M4 Pro;
- it is Apache-2.0 licensed, while the official quantization retains the Llama 3.1 model licence.

Sources: [Selene Mini model card](https://huggingface.co/AtlaAI/Selene-1-Mini-Llama-3.1-8B),
[official Q4_K_M GGUF](https://huggingface.co/AtlaAI/Selene-1-Mini-Llama-3.1-8B-Q4_K_M-GGUF),
and [Clef model card](https://huggingface.co/Cloudflare/clef#model).

Use **gpt-oss-20b** as the second calibration candidate and the operational fallback. It is not
post-trained as a judge, but it is a distinct model family, supports native structured outputs,
and has first-party LM Studio support. LM Studio lists a 12 GB minimum memory requirement and an
official `openai/gpt-oss-20b` package, so it also fits comfortably on this machine. It is the easier
drop-in when strict JSON-schema reliability matters more than evaluator specialization.

Sources: [OpenAI gpt-oss-20b documentation](https://developers.openai.com/api/docs/models/gpt-oss-20b),
[OpenAI open-model overview](https://openai.com/open-models/), and
[LM Studio gpt-oss model page](https://lmstudio.ai/models/openai/gpt-oss-20b).

Do not select either model from public leaderboard rank alone. Run both on the same human-labelled,
grouped development set and locked holdout. Promote the model with the best human agreement and
critical-error rate; keep deterministic gold-label metrics as the release authority. This follows
the repository's existing [judge audit](promptfoo-classifier-judge-best-practices.md) and
[Promptfoo's calibration guidance](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/#build-a-judge-the-calibration-workflow).

## Why judge type matters

The repository asks one question: whether a single classifier prediction is supported by a
transcript and a bounded ontology. That is **pointwise rubric grading**. RewardBench primarily tests
whether a model prefers the better of two responses. A high RewardBench score is useful evidence,
but a pairwise critic or scalar reward model is not automatically a drop-in pointwise judge.

| Model | Type | Fit for this repository | Local deployment |
| --- | --- | --- | --- |
| **Atla Selene 1 Mini 8B** | Evaluation-specialized generative model; pointwise classification/absolute scoring and pairwise grading | **Best first candidate.** Directly matches the binary/three-way rubric and can return a critique and structured verdict. | Official 4.92 GB Q4_K_M GGUF; LM Studio-compatible. |
| **gpt-oss-20b** | General-purpose reasoning model with structured outputs | **Best operational fallback.** Strong prompt following and schema support, but not specifically trained or benchmarked as a judge. | First-party LM Studio package; 12 GB minimum system memory. |
| **Prometheus 2 7B** | Evaluation-specialized generative model; absolute and pairwise grading | Good pointwise baseline, but requires its exact Mistral prompt template, a reference answer, a 1–5 rubric, and parsing `Feedback ... [RESULT] score`. That is more adaptation than Selene's binary/classification interface. | Official GGUF has LM Studio support. |
| **SFR-nemo-12B-Judge-r** | Generative reward model for pairwise preference | Strong pairwise comparator, not the natural primary judge for one ontology prediction. The official model repository is gated, adding deployment friction. | 12B class should be locally tractable, but access and prompt packaging are less convenient. |
| **Skywork-Critic-Llama-3.1-8B** | Generative pairwise critic | Useful for A/B classifier comparisons, not the primary pointwise verdict. Its card warns that single-rating ability may be weaker. | 8B Llama model; quantizations exist. |
| **Skywork-Reward-Gemma-2-27B-v0.2** | Sequence-classification scalar reward model | Strong preference scorer, but it returns a scalar logit rather than a textual rubric verdict/reason. It needs a decision/sequence-classification adapter instead of the current chat-completions judge. | Quantized weights fit the hardware in principle, but integration is materially different. |

Primary sources:

- [Prometheus 2 model card](https://huggingface.co/prometheus-eval/prometheus-7b-v2.0) and
  [official GGUF](https://huggingface.co/prometheus-eval/prometheus-7b-v2.0-GGUF)
- [Skywork Critic model card](https://huggingface.co/Skywork/Skywork-Critic-Llama-3.1-8B)
- [Skywork Reward Gemma v0.2 model card](https://huggingface.co/Skywork/Skywork-Reward-Gemma-2-27B-v0.2)
- [Ai2 RewardBench SFR-Nemo result](https://huggingface.co/datasets/allenai/reward-bench-results/blob/cf92cc12aa6a38d77145ed771cb4efd03f210038/eval-set/Salesforce/SFR-nemo-12B-Judge-r.json)
- [RewardBench repository and methodology](https://github.com/allenai/reward-bench)

## Benchmark evidence and limits

Public results support the distinction above:

- Selene's authors report evaluation across 11 benchmarks covering absolute scoring,
  classification, and pairwise preference, and identify it as the top 8B generative model on the
  then-current RewardBench. This is the closest published task mix to this repository's rubric.
- Prometheus 2 was explicitly merged to support both direct assessment and pairwise ranking, but its
  direct-assessment contract is fixed around a reference answer and a five-point rubric.
- Skywork reports RewardBench v1 overall scores of 90.3 for SFR-Nemo 12B and 89.0 for Skywork Critic
  8B. These are pairwise-preference results.
- Skywork Reward Gemma v0.2 reports 94.3 on RewardBench v1, but the model card and official Ai2
  result identify it as a sequence classifier. That number does not make it a generative pointwise
  rubric judge.
- OpenAI and LM Studio document gpt-oss-20b's local reasoning and structured-output capabilities,
  but the primary sources reviewed do not publish a judge-specific benchmark for it. It should be
  treated as a strong general model until local calibration provides task evidence.

The public benchmarks are dated and dominated by generic assistant-response preferences. The
repository's own human-labelled holdout is therefore the deciding benchmark.

## Calibration bake-off

Run only Selene Mini and gpt-oss-20b initially; adding all candidates would spend time without
answering the main design question.

1. Create 30–50 human-labelled development cases and a separate grouped holdout, split by
   `goldCase` so paraphrases cannot cross splits.
2. Give both judges the same system policy, ontology criteria, transcript, classifier prediction,
   and anchored `correct | incorrect | uncertain` rubric. Treat transcript and prediction as
   untrusted data.
3. Use deterministic decoding. Require a final schema-valid verdict; report invalid output,
   timeout, and refusal as `not_judged`, never as `incorrect`.
4. Compare exact agreement with human verdicts, per-verdict precision/recall, false acceptance of
   durable facts, `not_judged` rate, latency, and run-to-run consistency.
5. Pick the winner on the locked holdout. Do not restore the former Qwen judge as an independent
   vote because it is correlated with Clef.

Selene is now the default diagnostic judge. If its output contract proves unstable under LM Studio
while gpt-oss remains schema-valid with comparable human agreement, prefer gpt-oss operationally.
