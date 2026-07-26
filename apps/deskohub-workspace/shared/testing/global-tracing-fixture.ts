import {
  context,
  createTraceState,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { register } from "@/instrumentation";

const sinkUrl = process.env.SYNTHETIC_OTLP_TRACE_SINK_URL;
if (!sinkUrl) throw new Error("Synthetic OTLP trace sink URL is required.");
const sensitiveCategorySentinel = "SENSITIVE-CATEGORY-SENTINEL";
const validLookingSentinel = "SyntheticValidTelemetryName";

process.env.NEXT_RUNTIME = "nodejs";
process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = sinkUrl;
process.env.OTEL_EXPORTER_OTLP_TRACES_PROTOCOL = "http/json";
process.env.OTEL_BSP_SCHEDULE_DELAY = "10";
process.env.OTEL_RESOURCE_ATTRIBUTES = [
  `service.name=${validLookingSentinel}`,
  `telemetry.sdk.name=${validLookingSentinel}`,
  `detail=${validLookingSentinel}`,
].join(",");

await register();

const traceState = createTraceState("synthetic=SyntheticValidTraceState");
const span = trace
  .getTracerProvider()
  .getTracer(validLookingSentinel, "SyntheticValidScopeVersion", {
    schemaUrl: "https://SyntheticValidScopeSchema.test",
  })
  .startSpan(
    validLookingSentinel,
    {
      attributes: {
        checkoutSessionId: sensitiveCategorySentinel,
        customerId: sensitiveCategorySentinel,
        providerOrderId: sensitiveCategorySentinel,
        state: sensitiveCategorySentinel,
        url: `https://example.test/?state=${sensitiveCategorySentinel}`,
        category: validLookingSentinel,
        detail: validLookingSentinel,
        "http.route": `/checkout/${validLookingSentinel}`,
        "url.full": `https://example.test/${validLookingSentinel}`,
      },
      links: [
        {
          context: {
            traceId: "1".repeat(32),
            spanId: "2".repeat(16),
            traceFlags: 1,
            traceState,
          },
          attributes: { visible: validLookingSentinel },
        },
      ],
    },
    trace.setSpanContext(context.active(), {
      traceId: "3".repeat(32),
      spanId: "4".repeat(16),
      traceFlags: 1,
      traceState,
    })
  );

span.addEvent(validLookingSentinel, {
  response: validLookingSentinel,
  payload: validLookingSentinel,
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

const resourceProvider = new BasicTracerProvider({
  resource: resourceFromAttributes({
    "service.name": validLookingSentinel,
    "telemetry.sdk.name": validLookingSentinel,
    detail: validLookingSentinel,
  }),
});
const resourceSpan = resourceProvider
  .getTracer("workspace-resource-fixture")
  .startSpan(validLookingSentinel);
resourceSpan.end();
await resourceProvider.shutdown();

await new Promise((resolve) => setTimeout(resolve, 250));
