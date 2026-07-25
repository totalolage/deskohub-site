import "@/shared/testing/workspace-test-env";

import { describe, expect, spyOn, test } from "bun:test";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Cause, Effect, Layer, Logger } from "effect";
import {
  createCensoredOtelLogger,
  createCensoredOtelSpanExporter,
} from "@/shared/backend/logging/censorship";
import { createTracingLive } from "@/shared/backend/observability/otel-tracing";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { serializeErrorForLog } from "@/shared/utils/error-formatting";
import { loadCheckoutPayState } from "./checkout-pay-state-loader";
import {
  checkoutStatePrivacySentinels,
  makeAuthenticatedMalformedPayStateToken,
} from "./checkout-state-observability.test-utils";
import { openPayState } from "./pay-state";
import { PayableReservationService } from "./payable-reservation.service";

const expectNoCheckoutStateSentinels = (value: unknown) => {
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  for (const sentinel of Object.values(checkoutStatePrivacySentinels)) {
    expect(serialized).not.toContain(sentinel);
  }
};

const getMalformedStateFailure = () =>
  Effect.runSync(
    openPayState(makeAuthenticatedMalformedPayStateToken()).pipe(Effect.flip)
  );

describe("checkout state observability", () => {
  test("does not retain authenticated malformed plaintext in errors or causes", () => {
    const failure = getMalformedStateFailure();
    const cause = Cause.fail(failure);

    expectNoCheckoutStateSentinels(failure);
    expectNoCheckoutStateSentinels(serializeErrorForLog(failure));
    expectNoCheckoutStateSentinels(Cause.pretty(cause));
    expectNoCheckoutStateSentinels(cause);
    expectNoCheckoutStateSentinels(Cause.squash(cause));
  });

  test("does not emit authenticated malformed plaintext to the real console logger", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await loadCheckoutPayState(
        makeAuthenticatedMalformedPayStateToken()
      ).pipe(
        Effect.provide(
          Layer.succeed(PayableReservationService, {
            requireCurrent: () => Effect.die("must not be reached"),
          })
        ),
        runWorkspaceEffect("checkout.pay.load")
      );

      expect(warning).toHaveBeenCalled();
      expectNoCheckoutStateSentinels(warning.mock.calls);
    } finally {
      warning.mockRestore();
    }
  });

  test("does not emit authenticated malformed plaintext to OTel logs or spans", async () => {
    const logExporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(logExporter)],
    });
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(createCensoredOtelSpanExporter(spanExporter)),
      ],
    });
    const effect = openPayState(makeAuthenticatedMalformedPayStateToken()).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Checkout action rejected malformed state", {
          cause,
        })
      ),
      Effect.withSpan("checkout.pay.load"),
      Effect.exit,
      Effect.provide(Logger.layer([createCensoredOtelLogger(loggerProvider)])),
      Effect.provide(
        createTracingLive({
          provider: tracerProvider,
          serviceName: "checkout-state-observability-test",
        })
      )
    );

    try {
      await Effect.runPromise(effect);
      await Promise.all([
        loggerProvider.forceFlush(),
        tracerProvider.forceFlush(),
      ]);

      expectNoCheckoutStateSentinels(logExporter.getFinishedLogRecords());
      expectNoCheckoutStateSentinels(
        spanExporter.getFinishedSpans().map((span) => ({
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        }))
      );
    } finally {
      await Promise.all([loggerProvider.shutdown(), tracerProvider.shutdown()]);
    }
  });
});
