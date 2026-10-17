import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { randomUUID } from "node:crypto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const INSTRUMENTATION_NAME = "pipecat-mlx-voice";
const INSTRUMENTATION_VERSION = "0.1.0";

function signalEndpoint(base, signal) {
  return `${base.replace(/\/$/, "")}/v1/${signal}`;
}

/** Configure payload-free OTLP metrics and traces for one Node service. */
export function configureTelemetry(serviceName) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const enabled = endpoint && process.env.OTEL_SDK_DISABLED?.toLowerCase() !== "true";
  let meterProvider;
  let tracerProvider;

  if (enabled) {
    const resource = resourceFromAttributes({
      "service.name": serviceName,
      "service.namespace": "pipecat-mlx-voice",
      "service.instance.id": randomUUID(),
      "deployment.environment.name": process.env.OTEL_DEPLOYMENT_ENVIRONMENT || "local",
    });
    meterProvider = new MeterProvider({
      resource,
      readers: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: signalEndpoint(endpoint, "metrics") }),
        exportIntervalMillis: Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL || "5000", 10),
      })],
    });
    metrics.setGlobalMeterProvider(meterProvider);

    tracerProvider = new NodeTracerProvider({
      resource,
      spanProcessors: [new BatchSpanProcessor(
        new OTLPTraceExporter({ url: signalEndpoint(endpoint, "traces") }),
      )],
    });
    tracerProvider.register();
  }

  const meter = metrics.getMeter(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
  const tracer = trace.getTracer(INSTRUMENTATION_NAME, INSTRUMENTATION_VERSION);
  const operations = meter.createCounter("pipecat.operation", {
    unit: "{operation}",
    description: "Completed payload-free application operations",
  });
  const duration = meter.createHistogram("pipecat.operation.duration", {
    unit: "s",
    description: "Payload-free application operation duration",
  });

  const record = (operation, options = {}) => {
    const attributes = {
      "app.operation": operation,
      "app.outcome": options.outcome || "ok",
    };
    operations.add(options.count ?? 1, attributes);
    if (options.durationSeconds !== undefined) {
      duration.record(Math.max(0, options.durationSeconds), attributes);
    }
  };

  const observe = (operation, callback) => tracer.startActiveSpan(
    `${serviceName}.${operation}`,
    { attributes: { "app.operation": operation } },
    async (span) => {
      const started = performance.now();
      let outcome = "ok";
      try {
        return await callback();
      } catch (error) {
        outcome = "error";
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        record(operation, { outcome, durationSeconds: (performance.now() - started) / 1000 });
        span.end();
      }
    },
  );

  record("component.started");
  return {
    record,
    observe,
    shutdown: async () => {
      await Promise.all([meterProvider?.shutdown(), tracerProvider?.shutdown()]);
    },
  };
}
