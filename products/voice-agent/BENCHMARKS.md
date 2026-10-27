# Previous MLX Whisper benchmark

This is the pre-Parakeet baseline. The live broker now uses Parakeet TDT 0.6B v3 on MLX; rerun the
benchmark before using these STT numbers for current capacity planning.

Measured on 2026-10-10 after model warm-up:

- Apple M4 Pro, 14 logical CPUs
- 64 GiB unified memory
- macOS 26.6.2 (25G83)
- Ollama `qwen3.5:9b-mlx`
- MLX Kokoro `mlx-community/Kokoro-82M-bf16`
- MLX Whisper `mlx-community/whisper-large-v3-turbo-q4`

Five-run steady-state result:

| Stage | Median wall time | Average CPU | Peak CPU | Baseline RSS | Peak RSS | Throughput |
|---|---:|---:|---:|---:|---:|---:|
| LLM, 256 output tokens | 6.75 s | 68.2% | 107.2% | 7,908 MiB | 7,909 MiB | 37.7 tokens/s |
| TTS, 10.05 s speech | 0.39 s | 78.5% | 99.5% | 732 MiB | 732 MiB | 26.0× realtime |
| STT, 10.05 s speech | 0.49 s | 15.1% | 25.6% | 729 MiB | 732 MiB | 20.5× realtime |

On this machine, the warm inference processes therefore occupy about 8.44 GiB RSS combined. The
historical Compose stack measured approximately 262 MiB of idle services: voice-edge 192 MiB,
gateway 45 MiB, Postgres 25 MiB, and the unauthenticated local-test network anchor under 1 MiB.
Postgres has since been removed from the active task stack in favor of Pi Durable; these numbers
are a historical baseline, not current service sizing. The native worker used another 30 MiB.
System memory remained healthy with 58% reported free after the run.

CPU percentages use macOS process CPU time, where 100% means one fully occupied logical CPU. MLX
executes most tensor work on the Apple GPU, so CPU utilization is intentionally modest. RSS on
Apple Silicon includes unified-memory mappings but is not an exclusive measurement of GPU working
set. These numbers exclude cold model download/load time and Docker Desktop VM overhead.

Reproduce the steady-state benchmark:

```bash
make benchmark-mlx
# More samples or machine-readable output:
make benchmark-mlx ARGS="--iterations 5"
make benchmark-mlx ARGS="--iterations 5 --json"
```

The runner warms all three models, then samples the actual native broker or Ollama MLX runner at
100 ms intervals. It reports median wall time, process CPU-time utilization, sampled peak CPU,
baseline/peak RSS, tokens per second, and audio realtime factors. Keep the Mac on AC power and
avoid concurrent inference if comparing runs.
