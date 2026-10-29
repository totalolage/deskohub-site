import * as OtelTracer from "@effect/opentelemetry/Tracer";
import { isSpanContextValid, trace } from "@opentelemetry/api";
import { Effect, Option } from "effect";

/**
 * The ids of the current span, or of the outside span the effect continues,
 * which tie an event or a log to its trace; empty outside a span.
 */
export const collectSpanMetadata = Effect.gen(function* () {
  const currentSpan = yield* Effect.currentParentSpan.pipe(Effect.option);
  return currentSpan.pipe(
    Option.map((span) => ({
      "effect.span_id": span.spanId,
      "effect.trace_id": span.traceId,
    })),
    Option.getOrElse(() => ({}))
  );
});

/**
 * Parents `effect` on the OpenTelemetry span active where this is called,
 * such as the span of the request being served. The effect stays in that
 * trace wherever a runtime runs it, even one without tracing.
 */
export const continueActiveTrace = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext)
    ? OtelTracer.withSpanContext(effect, spanContext)
    : effect;
};
