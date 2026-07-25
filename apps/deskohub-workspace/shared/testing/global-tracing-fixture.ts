import { SpanStatusCode, trace } from "@opentelemetry/api";
import { register } from "@/instrumentation";

const sinkUrl = process.env.SYNTHETIC_OTLP_TRACE_SINK_URL;
if (!sinkUrl) throw new Error("Synthetic OTLP trace sink URL is required.");

process.env.NEXT_RUNTIME = "nodejs";
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = sinkUrl;
process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/json";
process.env.OTEL_BSP_SCHEDULE_DELAY = "10";

await register();

const sensitiveCategorySentinel = "SENSITIVE-CATEGORY-SENTINEL";
const span = trace
  .getTracer("workspace-global-tracing-fixture")
  .startSpan(`GET https://example.test/checkout/${sensitiveCategorySentinel}`, {
    attributes: {
      checkoutSessionId: sensitiveCategorySentinel,
      customerId: sensitiveCategorySentinel,
      providerOrderId: sensitiveCategorySentinel,
      state: sensitiveCategorySentinel,
      url: `https://example.test/?state=${sensitiveCategorySentinel}`,
    },
  });

span.recordException(
  new AggregateError(
    [
      sensitiveCategorySentinel,
      new Error(sensitiveCategorySentinel, {
        cause: { customerId: sensitiveCategorySentinel },
      }),
    ],
    sensitiveCategorySentinel
  )
);
span.setStatus({
  code: SpanStatusCode.ERROR,
  message: sensitiveCategorySentinel,
});
span.end();

await new Promise((resolve) => setTimeout(resolve, 250));
