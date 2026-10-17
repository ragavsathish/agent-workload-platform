# Platform

Platform contexts provide stable capabilities consumed by more than one
product. They may depend on external systems and vendor sources, but must not
import product internals.

- [`agent-execution`](agent-execution/README.md) provides isolated agent
  sessions and capability adapters. Voice Agent is its current product
  consumer.
- [`observability`](observability/) provides shared payload-free OpenTelemetry
  metrics and traces.
