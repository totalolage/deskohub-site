import { describe, expect, test } from "bun:test";
import http from "node:http";
import https from "node:https";
import { testEmailAddress } from "@deskohub/test-email";
import { context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BatchLogRecordProcessor,
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { FetchInstrumentation } from "@vercel/otel";
import { Effect, Logger } from "effect";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";
import { createCensoredOtelLogger } from "../logging/censorship";
import {
  createIdentifiedTracingLive,
  createPostHogLoggerProvider,
  createPostHogTracerProvider,
  createWorkspaceLoggerProvider,
  createWorkspaceTracerProvider,
  flushLoggerProvider,
  workspaceOTelRegistration,
} from "./telemetry-sinks";

/** Stand-in for a Cloudinary URL signature; never a real signature. */
const syntheticSignature = "s--fake-signature--";
const signedUrl = `https://res.cloudinary.test/demo/image/list/${syntheticSignature}/gallery.json`;

/**
 * Fetches `signedUrl` through the `@vercel/otel` fetch instrumentation that
 * `registerOTel` installs, which names the span after the full request URL,
 * recording into `provider`.
 */
const fetchSignedUrlTraced = async (
  provider: BasicTracerProvider,
  finishedSpans: () => readonly unknown[]
) => {
  const contextManager = new AsyncLocalStorageContextManager().enable();
  const instrumentation = new FetchInstrumentation();
  const platformFetch = globalThis.fetch;
  const platformHttp = { request: http.request, get: http.get };
  const platformHttps = { request: https.request, get: https.get };
  const fetchDisabledByInstrumentation = process.env.NEXT_OTEL_FETCH_DISABLED;
  const fakeFetch = Object.assign(
    () => Promise.resolve(Response.json({ resources: [] })),
    { preconnect: platformFetch.preconnect }
  );

  context.setGlobalContextManager(contextManager);
  globalThis.fetch = fakeFetch;
  try {
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();

    const response = await globalThis.fetch(signedUrl);
    await response.json();
    // The instrumentation ends the span once it has measured the body.
    for (
      let attempt = 0;
      attempt < 100 && finishedSpans().length === 0;
      attempt += 1
    ) {
      await provider.forceFlush();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    instrumentation.disable();
    globalThis.fetch = platformFetch;
    Object.assign(http, platformHttp);
    Object.assign(https, platformHttps);
    if (fetchDisabledByInstrumentation === undefined) {
      delete process.env.NEXT_OTEL_FETCH_DISABLED;
    } else {
      process.env.NEXT_OTEL_FETCH_DISABLED = fetchDisabledByInstrumentation;
    }
    context.disable();
    contextManager.disable();
  }
};

const expectSignatureRedacted = (exporter: InMemorySpanExporter) => {
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  expect(spans[0]?.name).toContain("s--REDACTED--");
  expect(
    JSON.stringify(
      spans.map(({ name, attributes, events, status }) => ({
        name,
        attributes,
        events,
        status,
      }))
    )
  ).not.toContain(syntheticSignature);
};

describe("Workspace span redaction", () => {
  test("the registration's redactors scrub signed Cloudinary URLs before its exporters see a span", async () => {
    const exporter = new InMemorySpanExporter();
    // The SDK's in-memory exporter stands in for the automatic exporters.
    const provider = new BasicTracerProvider({
      spanProcessors: workspaceOTelRegistration().spanProcessors.map(
        (processor): SpanProcessor =>
          processor === "auto" ? new SimpleSpanProcessor(exporter) : processor
      ),
    });

    try {
      await fetchSignedUrlTraced(provider, () => exporter.getFinishedSpans());

      expectSignatureRedacted(exporter);
      expect(exporter.getFinishedSpans()[0]?.attributes["http.url"]).toContain(
        "s--REDACTED--"
      );
    } finally {
      await provider.shutdown();
    }
  });

  test("a Workspace tracer provider redacts signed URLs and censors span data before export", async () => {
    const exporter = new InMemorySpanExporter();
    const privateValue = testEmailAddress("private");
    const provider = createWorkspaceTracerProvider(exporter, {
      deploymentEnvironment: "preview",
      serviceName: "deskohub-workspace-e2e-test",
      serviceVersion: "synthetic-sha",
    });

    try {
      await fetchSignedUrlTraced(provider, () => exporter.getFinishedSpans());
      expectSignatureRedacted(exporter);

      exporter.reset();
      await Effect.runPromise(
        Effect.void.pipe(
          Effect.withSpan("safe.operation", {
            attributes: { email: privateValue },
          }),
          Effect.provide(createIdentifiedTracingLive({}, provider))
        )
      );
      await provider.forceFlush();

      const [span] = exporter.getFinishedSpans();
      expect(span?.attributes.email).toBe(CENSORED_LOG_VALUE);
      // Censorship keeps only the trusted identity keys of a resource.
      expect(span?.resource.attributes["service.name"]).toBe(
        "deskohub-workspace-e2e-test"
      );
      expect(JSON.stringify(span?.attributes)).not.toContain(privateValue);
    } finally {
      await provider.shutdown();
    }
  });
});

describe("createIdentifiedTracingLive", () => {
  test("exports nested Effect spans and correlates their logs", async () => {
    const spanExporter = new InMemorySpanExporter();
    const tracerProvider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    const logExporter = new InMemoryLogRecordExporter();
    const loggerProvider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
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
          Effect.provide(
            createIdentifiedTracingLive(
              { serviceVersion: "synthetic-sha" },
              tracerProvider
            )
          )
        )
      );

      const spans = spanExporter.getFinishedSpans();
      const actionSpan = spans.find(({ name }) => name === "safeAction");
      const checkoutSpan = spans.find(
        ({ name }) => name === "checkout.createHostedPaymentCheckout"
      );
      const [logRecord] = logExporter.getFinishedLogRecords();

      expect(checkoutSpan?.spanContext().traceId).toBe(
        actionSpan?.spanContext().traceId
      );
      expect(checkoutSpan?.parentSpanContext?.spanId).toBe(
        actionSpan?.spanContext().spanId
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
});

describe("flushLoggerProvider", () => {
  const runFlush = async (flush: Effect.Effect<void>) => {
    const warnings: unknown[] = [];
    const captureLogger = Logger.make(({ logLevel, message }) => {
      if (logLevel === "Warn") {
        warnings.push(Array.isArray(message) ? message[0] : message);
      }
    });

    await Effect.runPromise(
      withInstantSleeps(flush).pipe(
        Effect.provide(Logger.layer([captureLogger]))
      )
    );

    return warnings;
  };

  test("exports the records the provider buffers", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter,
          scheduledDelayMillis: 60_000,
        }),
      ],
    });

    try {
      provider.getLogger("test").emit({ body: "buffered" });
      expect(exporter.getFinishedLogRecords()).toHaveLength(0);

      expect(await runFlush(flushLoggerProvider(provider))).toEqual([]);
      expect(exporter.getFinishedLogRecords()).toHaveLength(1);
    } finally {
      await provider.shutdown();
    }
  });

  test("bounds a flush by its deadline when the provider does not settle", async () => {
    const provider = {
      forceFlush: () => new Promise<void>(() => undefined),
    } as Pick<LoggerProvider, "forceFlush">;

    expect(await runFlush(flushLoggerProvider(provider))).toEqual([
      "PostHog log flush exceeded its post-response deadline.",
    ]);
  });

  test("warns without failing when the provider rejects", async () => {
    const provider = {
      forceFlush: () => Promise.reject(new Error("export failed")),
    } as Pick<LoggerProvider, "forceFlush">;

    expect(await runFlush(flushLoggerProvider(provider, 1_000))).toEqual([
      "PostHog log flush failed.",
    ]);
  });

  test("does nothing without a provider", async () => {
    expect(await runFlush(flushLoggerProvider(undefined))).toEqual([]);
  });
});

describe("createPostHogTracerProvider", () => {
  const identity = { serviceName: "workspace-test" };

  test("exports nothing without a project token", () => {
    expect(
      createPostHogTracerProvider({
        ...identity,
        posthogHost: "https://ingest.posthog.example",
      })
    ).toBeUndefined();
  });

  test("requires the ingest host with a project token", () => {
    expect(() =>
      createPostHogTracerProvider({
        ...identity,
        posthogProjectToken: "synthetic-project-token",
      })
    ).toThrow("POSTHOG_INGEST_HOST is required");
  });

  test("builds a tracer provider for the project's ingest host", async () => {
    const provider = createPostHogTracerProvider({
      ...identity,
      posthogHost: "https://ingest.posthog.example",
      posthogProjectToken: "synthetic-project-token",
    });

    expect(provider?.getTracer("workspace-test")).toBeDefined();
    await provider?.shutdown();
  });
});

describe("createPostHogLoggerProvider", () => {
  const posthogHost = "https://ingest.posthog.example";
  const posthogProjectToken = "synthetic-project-token";

  test("exports nothing outside production by default, even without a host", () => {
    for (const deploymentEnvironment of ["preview", "development", undefined]) {
      expect(
        createPostHogLoggerProvider({
          deploymentEnvironment,
          posthogProjectToken,
        })
      ).toBeUndefined();
    }
  });

  test("exports nothing without a project token", () => {
    expect(
      createPostHogLoggerProvider({
        deploymentEnvironment: "production",
        logsExport: "always",
        posthogHost,
      })
    ).toBeUndefined();
  });

  test("exports production logs by default", async () => {
    const provider = createPostHogLoggerProvider({
      deploymentEnvironment: "production",
      posthogHost,
      posthogProjectToken,
    });

    expect(provider).toBeInstanceOf(LoggerProvider);
    await provider?.shutdown();
  });

  test("exports logs from any environment that opts in", async () => {
    const provider = createPostHogLoggerProvider({
      deploymentEnvironment: "preview",
      logsExport: "always",
      posthogHost,
      posthogProjectToken,
    });

    expect(provider).toBeInstanceOf(LoggerProvider);
    await provider?.shutdown();
  });

  test("requires the ingest host and environment once export is on", () => {
    expect(() =>
      createPostHogLoggerProvider({
        deploymentEnvironment: "production",
        posthogProjectToken,
      })
    ).toThrow("POSTHOG_INGEST_HOST");
    expect(() =>
      createPostHogLoggerProvider({
        logsExport: "always",
        posthogHost,
        posthogProjectToken,
      })
    ).toThrow("VERCEL_ENV");
  });
});

describe("createWorkspaceLoggerProvider", () => {
  test("truncates attribute values longer than 4096 characters before export", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = createWorkspaceLoggerProvider(exporter, {
      serviceName: "workspace-test",
    });

    provider.getLogger("test").emit({
      attributes: { long: "x".repeat(5_000), short: "kept" },
      body: "bounded",
    });
    await provider.forceFlush();

    const [record] = exporter.getFinishedLogRecords();
    expect(String(record?.attributes.long)).toHaveLength(4_096);
    expect(record?.attributes.short).toBe("kept");
    await provider.shutdown();
  });
});
