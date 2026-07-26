import { describe, expect, test } from "bun:test";
import { EmailServiceError } from "@deskohub/email";
import { context, SpanStatusCode } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
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
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { StorageError } from "@/shared/backend/errors";
import { createCensoredOtelLogger } from "../logging/censorship";
import { createWorkspaceTracingLive } from "./workspace-tracing";

describe("createWorkspaceTracingLive", () => {
  test("exports nested Effect spans and correlates their logs", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const logExporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(logExporter)],
    });
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);

    try {
      await Effect.runPromise(
        Effect.logInfo("checkout ready").pipe(
          Effect.withSpan("checkout.createHostedPaymentCheckout"),
          Effect.withSpan("safeAction"),
          Effect.provide(
            Logger.layer([createCensoredOtelLogger(loggerProvider)])
          ),
          Effect.provide(createWorkspaceTracingLive(tracerProvider))
        )
      );

      const spans = spanExporter.getFinishedSpans();
      const actionSpan = spans.find(({ name }) => name === "safeAction");
      const checkoutSpan = spans.find(
        ({ name }) => name === "checkout.createHostedPaymentCheckout"
      );
      const [logRecord] = logExporter.getFinishedLogRecords();

      expect(actionSpan).toBeDefined();
      expect(checkoutSpan).toBeDefined();
      expect(checkoutSpan?.spanContext().traceId).toBe(
        actionSpan?.spanContext().traceId
      );
      expect(checkoutSpan?.parentSpanContext?.spanId).toBe(
        actionSpan?.spanContext().spanId
      );
      expect(logRecord?.spanContext?.traceId).toBe(
        checkoutSpan?.spanContext().traceId
      );
      expect(logRecord?.spanContext?.spanId).toBe(
        checkoutSpan?.spanContext().spanId
      );
    } finally {
      context.disable();
      contextManager.disable();
      await Promise.all([tracerProvider.shutdown(), loggerProvider.shutdown()]);
    }
  });

  test("does not export provider-derived failure details on spans", async () => {
    const marker = "synthetic-provider-marker";
    const nestedMarker = "synthetic-cause-marker";
    const identifier = "synthetic-reservation-id";
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const contextManager = new AsyncLocalStorageContextManager().enable();
    context.setGlobalContextManager(contextManager);
    const providerError = new StorageError({
      message: marker,
      operation: identifier,
      cause: new EmailServiceError(marker, new Error(nestedMarker), identifier),
    });

    try {
      await Effect.runPromiseExit(
        Effect.fail(providerError).pipe(
          Effect.withSpan("email.send"),
          Effect.provide(createWorkspaceTracingLive(tracerProvider))
        )
      );

      const [failedSpan] = spanExporter.getFinishedSpans();
      const exportedFailure = {
        attributes: failedSpan?.attributes,
        events: failedSpan?.events,
        status: failedSpan?.status,
      };
      const serialized = JSON.stringify(exportedFailure);

      expect(failedSpan?.status).toEqual({ code: SpanStatusCode.ERROR });
      expect(failedSpan?.events).toHaveLength(1);
      expect(failedSpan?.events[0]?.attributes).toEqual({
        "exception.type": "Error",
      });
      expect(serialized).not.toContain(marker);
      expect(serialized).not.toContain(nestedMarker);
      expect(serialized).not.toContain(identifier);
    } finally {
      context.disable();
      contextManager.disable();
      await tracerProvider.shutdown();
    }
  });
});
