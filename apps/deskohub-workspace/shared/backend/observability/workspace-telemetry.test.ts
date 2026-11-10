import { afterAll, describe, expect, test } from "bun:test";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  type ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import { Effect, References } from "effect";

// A synthetic project token and the opt-in turn PostHog logging on in the
// test process's development environment; nothing is exported because no
// test emits a record through the provider.
process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "synthetic-project-token";
process.env.POSTHOG_LOGS_EXPORT = "always";
process.env.NEXT_PUBLIC_POSTHOG_HOST ??= "https://posthog.example";

type WorkspaceTelemetry = typeof import("./workspace-telemetry");

// Next.js evaluates the module once for `instrumentation.ts` and again for
// the app bundles; a query string gives Bun a second instance the same way.
const instrumentationInstance: WorkspaceTelemetry = await import(
  "./workspace-telemetry"
);
const appInstanceSpecifier = "./workspace-telemetry?app-bundle";
const appInstance: WorkspaceTelemetry = await import(appInstanceSpecifier);

afterAll(() => instrumentationInstance.workspaceLoggerProvider()?.shutdown());

describe("workspaceLoggerProvider", () => {
  test("gives every module instance the one provider the process built", () => {
    expect(appInstance).not.toBe(instrumentationInstance);

    const provider = instrumentationInstance.workspaceLoggerProvider();

    expect(provider).toBeInstanceOf(LoggerProvider);
    expect(appInstance.workspaceLoggerProvider()).toBe(provider);
    expect(
      Reflect.get(globalThis, appInstance.workspaceTelemetryHandle)
    ).toEqual({ loggerProvider: provider });
  });
});

describe("WorkspaceObservabilityLive", () => {
  test("sets the minimum log level of the runs it serves", async () => {
    // The test process runs as a development deployment.
    const level = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* References.MinimumLogLevel;
      }).pipe(
        Effect.provide(instrumentationInstance.WorkspaceObservabilityLive)
      )
    );

    expect(level).toBe("Debug");
  });
});

describe("workspaceOTelRegistration", () => {
  test("registers the Workspace identity with the redactors ahead of the automatic exporters", () => {
    const { attributes, serviceName, spanProcessors } =
      instrumentationInstance.workspaceOTelRegistration();

    expect(serviceName).toBe("deskohub-workspace");
    expect(attributes).toEqual({ "service.namespace": "deskohub" });
    expect(spanProcessors.at(-1)).toBe("auto");
    expect(spanProcessors.indexOf("auto")).toBe(spanProcessors.length - 1);
  });
});

describe("flushWorkspaceLogs", () => {
  test("passes the deadline to the SDK flush", async () => {
    const previous = Reflect.get(
      globalThis,
      instrumentationInstance.workspaceTelemetryHandle
    );
    let options: unknown;
    Reflect.set(globalThis, instrumentationInstance.workspaceTelemetryHandle, {
      loggerProvider: {
        forceFlush: (value: Parameters<LoggerProvider["forceFlush"]>[0]) => {
          options = value;
          return Promise.resolve();
        },
      },
    });
    try {
      await Effect.runPromise(instrumentationInstance.flushWorkspaceLogs);
      expect(options).toEqual({ timeoutMillis: 2000 });
    } finally {
      Reflect.set(
        globalThis,
        instrumentationInstance.workspaceTelemetryHandle,
        previous
      );
    }
  });

  test("exports what was logged during another module instance's export", async () => {
    const exported: string[] = [];
    let releaseExport: () => void = () => undefined;
    const exportReleased = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const { promise: firstExportStarted, resolve: startFirstExport } =
      Promise.withResolvers<void>();
    // Holds the first export open, as a slow PostHog response would.
    const exporter: LogRecordExporter = {
      export: (records: ReadableLogRecord[], done) => {
        exported.push(...records.map(({ body }) => String(body)));
        startFirstExport();
        // 0 is the SDK's success result code.
        exportReleased.then(() => done({ code: 0 }));
      },
      shutdown: () => Promise.resolve(),
    };
    const loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor({
          exporter,
          scheduledDelayMillis: 60_000,
        }),
      ],
    });
    const previous = Reflect.get(
      globalThis,
      instrumentationInstance.workspaceTelemetryHandle
    );
    Reflect.set(globalThis, instrumentationInstance.workspaceTelemetryHandle, {
      loggerProvider,
    });

    try {
      const logger = loggerProvider.getLogger("test");
      logger.emit({ body: "first request" });
      const first = Effect.runPromise(
        instrumentationInstance.flushWorkspaceLogs
      );
      await firstExportStarted;
      logger.emit({ body: "second request" });
      const second = Effect.runPromise(appInstance.flushWorkspaceLogs);
      releaseExport();
      await Promise.all([first, second]);

      expect(exported).toEqual(["first request", "second request"]);
    } finally {
      Reflect.set(
        globalThis,
        instrumentationInstance.workspaceTelemetryHandle,
        previous
      );
      await loggerProvider.shutdown();
    }
  });
});
