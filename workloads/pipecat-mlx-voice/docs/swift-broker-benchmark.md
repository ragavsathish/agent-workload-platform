# Python–Swift broker benchmark

## Method

Both brokers must receive identical authenticated OpenAI-compatible requests on loopback. The
benchmark warms each model, then measures three iterations of LLM, TTS, and STT. For a valid Swift
comparison, `--stt-wav` must point to a mono PCM16/16 kHz recording of the enrolled owner; generated
Kokoro speech is intentionally rejected by the Swift speaker gate and is not a valid STT comparison.

The differential interface probe compares authorization behavior, status, media type, and JSON or
PCM shape without printing prompts, transcripts, audio, credentials, or generated content.

## Python baseline — 2026-10-10

Host: Apple Silicon, 14 logical CPUs. Broker: Python MLX on `127.0.0.1:9443`. LLM:
`qwen3.5:9b-mlx`. Input audio: 10.05 seconds. Three warmed iterations.

| Stage | Median wall time | Mean throughput | Mean CPU | Peak CPU | Broker/model peak RSS |
|---|---:|---:|---:|---:|---:|
| LLM | 6.687 s | 38.13 tokens/s | 66.5% | 78.4% | 7,907.7 MiB |
| TTS | 0.392 s | 25.78 audio-s/s | 81.2% | 99.6% | 378.7 MiB |
| STT | 0.448 s | 22.43 audio-s/s | 15.6% | 17.5% | 378.7 MiB |

Live interface checks passed for authenticated health (`200`), anonymous rejection (`401`), fixed
Ollama chat (`200`), Pi chat (`200`), and PCM TTS (`200`, `application/octet-stream`).

## Native Swift result — 2026-10-10

The signed, notarized Swift 6.3.3 user toolchain was installed for the current user and paired with
the compatible macOS 26.5 SDK; the mismatched system Command Line Tools were not modified. The full
macOS release target compiled, linked, and passed all 19 tests. The five artifact trees (eight Core ML
graphs, 718 MiB) match `Models.lock.json`, contain no unresolved LFS pointers or symbolic links, load
successfully, and complete zero-input predictions.

Three warmed iterations were run against Python on port 9443 and Swift on port 9445. Both used the
same `qwen3.5:9b-mlx` Ollama process. STT was explicitly skipped because no owner recording/profile
exists; synthesizing an enrollment voice would invalidate the speaker-security measurement.

| Stage | Python median | Swift median | Python throughput | Swift throughput | Result |
|---|---:|---:|---:|---:|---:|
| LLM proxy | 6.71 s | 6.66 s | 37.87 tokens/s | 38.52 tokens/s | effectively equal |
| TTS inference | 0.38 s | 0.21 s | 26.48 audio-s/s | 46.94 audio-s/s | Swift 44.7% less wall time; 77.3% more throughput |

Python TTS averaged 78.2% CPU and peaked at 209 MiB RSS in this run. Swift TTS averaged 52.6% CPU
and the broker peaked at 2,104 MiB RSS. Swift's larger resident set is expected from eagerly loading
VAD, speaker, Whisper, and Kokoro models together; it is a real deployment tradeoff even though TTS
itself is faster.

The differential live probe passed nine contract cases: authenticated and anonymous health, invalid
chat model, JSON chat, SSE chat, PCM TTS, Pi JSON, Pi SSE, and rejection of Pi tool declarations.
The first version buffered Ollama SSE (874 ms time-to-first-byte versus Python's 75 ms). After the
streaming proxy fix, Swift measured 75 ms versus Python's 75 ms, with total response times of 876 ms
and 871 ms respectively.

The remaining fair STT comparison requires enrollment from at least three clean owner utterances and
the same mono PCM16/16 kHz owner WAV supplied to both brokers:

```sh
make benchmark-swift STT_WAV=/absolute/path/to/owner.wav
make compare-broker-interfaces STT_WAV=/absolute/path/to/owner.wav
```
