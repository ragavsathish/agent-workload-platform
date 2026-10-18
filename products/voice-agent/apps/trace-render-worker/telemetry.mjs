import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { randomUUID } from 'node:crypto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/u, '');
let meterProvider;
let tracerProvider;
if (endpoint && process.env.OTEL_SDK_DISABLED?.toLowerCase() !== 'true') {
  const resource = resourceFromAttributes({
    'service.name': 'playwright-trace-render-worker',
    'service.namespace': 'pipecat-mlx-voice',
    'service.instance.id': randomUUID(),
    'deployment.environment.name': process.env.OTEL_DEPLOYMENT_ENVIRONMENT ?? 'local',
  });
  meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? '5000'),
    })],
  });
  metrics.setGlobalMeterProvider(meterProvider);
  tracerProvider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
  });
  tracerProvider.register();
}

const meter = metrics.getMeter('trace-render-worker', '0.1.0');
const tracer = trace.getTracer('trace-render-worker', '0.1.0');
const operations = meter.createCounter('trace_render.operation', { unit: '{operation}' });
const durations = meter.createHistogram('trace_render.operation.duration', { unit: 's' });

export const telemetry = {
  record(operation, outcome = 'ok', durationSeconds) {
    const attributes = { 'app.operation': operation, 'app.outcome': outcome };
    operations.add(1, attributes);
    if (durationSeconds !== undefined) durations.record(Math.max(0, durationSeconds), attributes);
  },
  observe(operation, callback) {
    return tracer.startActiveSpan(`playwright-trace-render-worker.${operation}`, async (span) => {
      const started = performance.now();
      let outcome = 'ok';
      try {
        return await callback();
      } catch (error) {
        outcome = 'error';
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        this.record(operation, outcome, (performance.now() - started) / 1000);
        span.end();
      }
    });
  },
  async shutdown() {
    await Promise.all([meterProvider?.shutdown(), tracerProvider?.shutdown()]);
  },
};
