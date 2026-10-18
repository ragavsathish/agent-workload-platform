use opentelemetry::metrics::{Counter, Histogram, MeterProvider as _};
use opentelemetry::propagation::{Extractor, TextMapPropagator};
use opentelemetry::trace::{SpanKind, Status, TraceContextExt, Tracer as _, TracerProvider as _};
use opentelemetry::{Context, KeyValue};
use opentelemetry_otlp::{Protocol, WithExportConfig};
use opentelemetry_sdk::metrics::SdkMeterProvider;
use opentelemetry_sdk::propagation::TraceContextPropagator;
use opentelemetry_sdk::trace::{SdkTracer, SdkTracerProvider};
use opentelemetry_sdk::Resource;
use std::env;
use std::time::{Duration, Instant};

const SERVICE_NAME: &str = "pi-task-rpc";
const INSTRUMENTATION_SCOPE: &str = "pipecat-mlx-voice";

#[derive(Clone)]
pub struct Telemetry {
    tracer: SdkTracer,
    operations: Counter<u64>,
    duration: Histogram<f64>,
}

pub struct TelemetryRuntime {
    pub telemetry: Telemetry,
    tracer_provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
}

pub struct Operation {
    context: Context,
    telemetry: Telemetry,
    operation: &'static str,
    outcome: &'static str,
    started: Instant,
    finished: bool,
}

struct EnvironmentCarrier {
    traceparent: Option<String>,
    tracestate: Option<String>,
}

impl Extractor for EnvironmentCarrier {
    fn get(&self, key: &str) -> Option<&str> {
        if key.eq_ignore_ascii_case("traceparent") {
            return self.traceparent.as_deref();
        }
        if key.eq_ignore_ascii_case("tracestate") {
            return self.tracestate.as_deref();
        }
        None
    }

    fn keys(&self) -> Vec<&str> {
        vec!["traceparent", "tracestate"]
    }
}

impl TelemetryRuntime {
    pub fn configure() -> Self {
        let resource = Resource::builder_empty()
            .with_service_name(SERVICE_NAME)
            .with_attributes([
                KeyValue::new("service.namespace", "pipecat-mlx-voice"),
                KeyValue::new(
                    "service.instance.id",
                    format!("pi-task-rpc-{}", std::process::id()),
                ),
                KeyValue::new(
                    "deployment.environment.name",
                    env::var("OTEL_DEPLOYMENT_ENVIRONMENT").unwrap_or_else(|_| "local".into()),
                ),
            ])
            .build();
        let enabled = env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
            .is_ok_and(|value| !value.trim().is_empty())
            && !env::var("OTEL_SDK_DISABLED").is_ok_and(|value| value.eq_ignore_ascii_case("true"));

        let providers = if enabled {
            Self::exporting_providers(resource.clone()).unwrap_or_else(|| {
                eprintln!(
                    "pi-task-rpc: OpenTelemetry exporter unavailable; continuing without export"
                );
                Self::local_providers(resource)
            })
        } else {
            Self::local_providers(resource)
        };
        Self::from_providers(providers.0, providers.1)
    }

    fn exporting_providers(resource: Resource) -> Option<(SdkTracerProvider, SdkMeterProvider)> {
        let trace_exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_http()
            .with_protocol(Protocol::HttpBinary)
            .with_timeout(Duration::from_secs(2))
            .build()
            .ok()?;
        let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
            .with_http()
            .with_protocol(Protocol::HttpBinary)
            .with_timeout(Duration::from_secs(2))
            .build()
            .ok()?;
        Some((
            SdkTracerProvider::builder()
                .with_batch_exporter(trace_exporter)
                .with_resource(resource.clone())
                .build(),
            SdkMeterProvider::builder()
                .with_periodic_exporter(metric_exporter)
                .with_resource(resource)
                .build(),
        ))
    }

    fn local_providers(resource: Resource) -> (SdkTracerProvider, SdkMeterProvider) {
        (
            SdkTracerProvider::builder()
                .with_resource(resource.clone())
                .build(),
            SdkMeterProvider::builder().with_resource(resource).build(),
        )
    }

    fn from_providers(
        tracer_provider: SdkTracerProvider,
        meter_provider: SdkMeterProvider,
    ) -> Self {
        let tracer = tracer_provider.tracer(INSTRUMENTATION_SCOPE);
        let meter = meter_provider.meter(INSTRUMENTATION_SCOPE);
        let telemetry = Telemetry {
            tracer,
            operations: meter
                .u64_counter("pipecat.operation")
                .with_unit("{operation}")
                .with_description("Completed payload-free application operations")
                .build(),
            duration: meter
                .f64_histogram("pipecat.operation.duration")
                .with_unit("s")
                .with_description("Payload-free application operation duration")
                .build(),
        };
        Self {
            telemetry,
            tracer_provider,
            meter_provider,
        }
    }

    pub fn shutdown(&self) {
        let _ = self.tracer_provider.force_flush();
        let _ = self.meter_provider.force_flush();
        let _ = self.tracer_provider.shutdown();
        let _ = self.meter_provider.shutdown();
    }
}

impl Telemetry {
    pub fn session(&self, task_id: &str) -> Operation {
        let carrier = EnvironmentCarrier {
            traceparent: env::var("TRACEPARENT").ok(),
            tracestate: env::var("TRACESTATE").ok(),
        };
        let parent = TraceContextPropagator::new().extract(&carrier);
        self.start(
            &parent,
            "session",
            vec![KeyValue::new("task.id", task_id.to_owned())],
        )
    }

    pub fn start(
        &self,
        parent: &Context,
        operation: &'static str,
        attributes: Vec<KeyValue>,
    ) -> Operation {
        let mut attributes = attributes;
        attributes.push(KeyValue::new("app.operation", operation));
        let span = self
            .tracer
            .span_builder(format!("{SERVICE_NAME}.{operation}"))
            .with_kind(SpanKind::Internal)
            .with_attributes(attributes)
            .start_with_context(&self.tracer, parent);
        Operation {
            context: Context::new().with_span(span),
            telemetry: self.clone(),
            operation,
            outcome: "error",
            started: Instant::now(),
            finished: false,
        }
    }

    pub fn event(&self, parent: &Context, operation: &'static str, outcome: &'static str) {
        self.start(parent, operation, Vec::new()).finish(outcome);
    }

    fn record(&self, operation: &'static str, outcome: &'static str, duration: Duration) {
        let attributes = [
            KeyValue::new("app.operation", operation),
            KeyValue::new("app.outcome", outcome),
        ];
        self.operations.add(1, &attributes);
        self.duration.record(duration.as_secs_f64(), &attributes);
    }
}

impl Operation {
    pub fn context(&self) -> Context {
        self.context.clone()
    }

    pub fn set_outcome(&mut self, outcome: &'static str) {
        self.outcome = outcome;
    }

    pub fn finish(mut self, outcome: &'static str) {
        self.outcome = outcome;
        self.complete();
    }

    fn complete(&mut self) {
        if self.finished {
            return;
        }
        self.context
            .span()
            .set_attribute(KeyValue::new("app.outcome", self.outcome));
        if self.outcome != "ok" {
            self.context.span().set_status(Status::error(""));
        }
        self.context.span().end();
        self.telemetry
            .record(self.operation, self.outcome, self.started.elapsed());
        self.finished = true;
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        self.complete();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opentelemetry_sdk::trace::InMemorySpanExporter;
    use std::collections::BTreeSet;

    #[test]
    fn spans_include_only_bounded_operational_attributes() {
        let exporter = InMemorySpanExporter::default();
        let trace_provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter.clone())
            .build();
        let meter_provider = SdkMeterProvider::builder().build();
        let runtime = TelemetryRuntime::from_providers(trace_provider, meter_provider);
        let session = runtime
            .telemetry
            .session("00000000-0000-0000-0000-000000000001");
        let child = runtime.telemetry.start(
            &session.context(),
            "command",
            vec![KeyValue::new("rpc.command", "get_state")],
        );
        child.finish("ok");
        session.finish("ok");

        let spans = exporter.get_finished_spans().expect("finished spans");
        assert_eq!(spans.len(), 2);
        let keys = spans
            .iter()
            .flat_map(|span| {
                span.attributes
                    .iter()
                    .map(|attribute| attribute.key.as_str())
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(
            keys,
            BTreeSet::from(["app.operation", "app.outcome", "rpc.command", "task.id"])
        );
        runtime.shutdown();
    }
}
