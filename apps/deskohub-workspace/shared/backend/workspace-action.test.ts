import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { context, trace } from "@opentelemetry/api";
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
import { Duration, Effect, Schema } from "effect";
import { redirect } from "next/navigation";
import { m as administrationMessages } from "@/features/administration/i18n";
import { type Locale, m } from "@/features/i18n";

let actionHeaderReads = 0;
let actionRequestHeaders: Record<string, string> = {};
let failHeaderReads = false;
/** Replaces the result of the test's nth header read, counted from 1. */
let overrideHeaderRead = (_read: number): Promise<never> | undefined =>
  undefined;
let scheduledTelemetryFlushes = 0;
const logExporter = new InMemoryLogRecordExporter();

mock.module("server-only", () => ({}));
mock.module("./bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => false,
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));
mock.module("next/server", () => ({
  after: () => {
    scheduledTelemetryFlushes += 1;
  },
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter: logExporter })],
  }),
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => {
    actionHeaderReads += 1;
    const override = overrideHeaderRead(actionHeaderReads);
    if (override) return override;
    if (failHeaderReads) throw new Error("Synthetic header failure");
    return new Headers({
      referer: "https://deskohub.test/en-US",
      ...actionRequestHeaders,
    });
  },
}));

describe("Workspace actions", () => {
  afterEach(() => {
    actionRequestHeaders = {};
    failHeaderReads = false;
    overrideHeaderRead = () => undefined;
  });

  test("starts the lifecycle after validation and provides Bot protection", async () => {
    const { BotProtectionService } = await import(
      "./bot-protection/bot-protection.service"
    );
    const { defineWorkspaceAction } = await import("./workspace-action");
    actionHeaderReads = 0;
    const action = defineWorkspaceAction(
      {
        operation: "test.action",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
      },
      (input, context) =>
        Effect.map(BotProtectionService, () => ({
          clientInput: context.clientInput,
          locale: context.locale,
          value: input * 2,
        }))
    );

    await expect(action("invalid")).resolves.toMatchObject({
      validationErrors: expect.any(Object),
    });
    // The locale middleware reads once before validation; the action lifecycle
    // must not add its own request-context read for invalid input.
    expect(actionHeaderReads).toBe(1);

    await expect(action("21")).resolves.toEqual({
      data: { clientInput: "21", locale: "en-US", value: 42 },
    });
  });

  test("preserves nested validation errors for the client", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const action = defineWorkspaceAction(
      {
        operation: "test.nested-validation",
        schema: Schema.toStandardSchemaV1(
          Schema.Struct({
            discount: Schema.Struct({
              products: Schema.Array(
                Schema.Struct({ kind: Schema.Literal("cowork") })
              ),
            }),
          }),
          { parseOptions: { onExcessProperty: "error" } }
        ),
      },
      () => Effect.succeed("unreachable")
    );
    const staleInput = {
      discount: {
        products: [{ kind: "cowork" as const, tier: "basic" }],
      },
    };

    await expect(action(staleInput)).resolves.toMatchObject({
      validationErrors: {
        fieldErrors: {
          discount: ['products[0].tier: Unexpected key with value "basic"'],
        },
      },
    });
  });

  test("does not log validation paths when input logging is disabled", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const sensitiveKey = testEmailAddress("person");
    const action = defineWorkspaceAction(
      {
        logInput: false,
        operation: "test.private-validation",
        schema: Schema.toStandardSchemaV1(
          Schema.Struct({ query: Schema.String }),
          { parseOptions: { onExcessProperty: "error" } }
        ),
      },
      () => Effect.succeed("unreachable")
    );
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    try {
      await expect(
        action({ query: "safe", [sensitiveKey]: "private" })
      ).resolves.toMatchObject({ validationErrors: expect.any(Object) });

      expect(JSON.stringify(warn.mock.calls)).not.toContain(sensitiveKey);
    } finally {
      warn.mockRestore();
    }
  });

  // A Server Action on a path the proxy skips, such as a dotted one, reaches
  // the action with whatever headers the client sent.
  test.each([
    [
      "the request's own agent category",
      {
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      },
      { category: "ai_user_agent", name: "chatgpt" },
    ],
    [
      "no client-sent category",
      {
        "user-agent": "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0 Safari/537.36",
        "x-deskohub-agent-category": "ai_user_agent",
        "x-deskohub-agent-name": "chatgpt",
      },
      { category: "unclassified" },
    ],
  ])("puts %s in the request context", async (_, headers, traffic) => {
    actionRequestHeaders = headers;
    const { CurrentAgentTraffic } = await import("./workspace-request-context");
    const { defineWorkspaceAction } = await import("./workspace-action");
    const action = defineWorkspaceAction(
      {
        operation: "test.agent-traffic",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.gen(function* () {
          return yield* CurrentAgentTraffic;
        })
    );

    const result = await action("input");
    expect(result?.data).toEqual(traffic);
  });

  test("schedules a telemetry flush for validation failures", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const action = defineWorkspaceAction(
      {
        operation: "test.validation-flush",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.succeed("unreachable")
    );
    scheduledTelemetryFlushes = 0;

    await expect(action(42)).resolves.toMatchObject({
      validationErrors: expect.any(Object),
    });
    expect(scheduledTelemetryFlushes).toBe(1);
  });

  test("preserves public failures", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const { PublicSafeActionError } = await import(
      "../utils/safe-action-client"
    );
    const action = defineWorkspaceAction(
      {
        operation: "test.public-failure",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(new PublicSafeActionError({ message: "Public failure" }))
    );

    await expect(action("input")).resolves.toEqual({
      serverError: "Public failure",
    });
  });

  test("does not expose a public error nested inside an internal failure", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const { PublicSafeActionError } = await import(
      "../utils/safe-action-client"
    );
    const action = defineWorkspaceAction(
      {
        operation: "test.internal-failure",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(
          new Error("Internal failure", {
            cause: new PublicSafeActionError({ message: "Nested secret" }),
          })
        )
    );

    await expect(action("input")).resolves.toEqual({
      serverError: m.actionFailedUnexpectedly({}, { locale: "en-US" }),
    });
  });

  describe("runtime failures in the action's locale", () => {
    const locales = ["cs-CZ", "en-US"] as const satisfies readonly Locale[];
    const requestFrom = (locale: Locale) => {
      actionRequestHeaders = { referer: `https://deskohub.test/${locale}` };
    };

    test("customer copy differs per locale", () => {
      expect(m.actionTimedOut({}, { locale: "cs-CZ" })).not.toBe(
        m.actionTimedOut({}, { locale: "en-US" })
      );
      expect(m.actionFailedUnexpectedly({}, { locale: "cs-CZ" })).not.toBe(
        m.actionFailedUnexpectedly({}, { locale: "en-US" })
      );
    });

    test.each(locales)("reports a timeout in %s", async (locale) => {
      const { defineWorkspaceAction } = await import("./workspace-action");
      const action = defineWorkspaceAction(
        {
          deadline: Duration.millis(10),
          operation: "test.timeout",
          schema: Schema.toStandardSchemaV1(Schema.String),
        },
        () => Effect.never
      );
      requestFrom(locale);

      await expect(action("input")).resolves.toEqual({
        serverError: m.actionTimedOut({}, { locale }),
      });
    });

    test.each(locales)(
      "reports a failure the action didn't make public in %s",
      async (locale) => {
        const { defineWorkspaceAction } = await import("./workspace-action");
        const action = defineWorkspaceAction(
          {
            operation: "test.unexpected",
            schema: Schema.toStandardSchemaV1(Schema.String),
          },
          () => Effect.fail(new Error("Internal failure"))
        );
        requestFrom(locale);

        await expect(action("input")).resolves.toEqual({
          serverError: m.actionFailedUnexpectedly({}, { locale }),
        });
      }
    );

    test.each(locales)("reports a defect in %s", async (locale) => {
      const { defineWorkspaceAction } = await import("./workspace-action");
      const action = defineWorkspaceAction(
        {
          operation: "test.defect",
          schema: Schema.toStandardSchemaV1(Schema.String),
        },
        () => Effect.die(new Error("Synthetic defect"))
      );
      requestFrom(locale);

      await expect(action("input")).resolves.toEqual({
        serverError: m.actionFailedUnexpectedly({}, { locale }),
      });
    });

    // A runtime that cannot start rejects the action's run before it enters
    // the Effect, which the safe-action client sees as a thrown error.
    test.each(locales)(
      "reports and logs a run that rejects before the Effect starts in %s",
      async (locale) => {
        const { createWorkspaceActionClient } = await import(
          "../utils/safe-action-client"
        );
        const runtimeFailure = new Error("Runtime could not start");
        const logged: Error[] = [];
        const action = createWorkspaceActionClient({
          logUnexpectedFailure: async (error) => {
            logged.push(error);
          },
          unexpectedFailure: m.actionFailedUnexpectedly,
        }).action(() => Promise.reject(runtimeFailure));
        requestFrom(locale);

        await expect(action()).resolves.toEqual({
          serverError: m.actionFailedUnexpectedly({}, { locale }),
        });
        expect(logged).toEqual([runtimeFailure]);
      }
    );

    test("reports a failure before the locale is known in the base locale", async () => {
      const { baseLocale } = await import("@/features/i18n");
      const { defineWorkspaceAction } = await import("./workspace-action");
      const action = defineWorkspaceAction(
        {
          operation: "test.locale-failure",
          schema: Schema.toStandardSchemaV1(Schema.String),
        },
        () => Effect.succeed("unreachable")
      );
      failHeaderReads = true;

      await expect(action("input")).resolves.toEqual({
        serverError: m.actionFailedUnexpectedly({}, { locale: baseLocale }),
      });
    });
  });

  describe("failure copy and fallback", () => {
    const failureCopy = {
      timeout: administrationMessages.administrationActionTimedOut,
      unexpected: administrationMessages.administrationActionFailedUnexpectedly,
    };
    const fallback =
      administrationMessages.administrationReservationLookupFailed;
    const locale = "cs-CZ";

    test("an action's failure copy replaces the customer copy", async () => {
      const { defineWorkspaceAction } = await import("./workspace-action");
      const timeout = defineWorkspaceAction(
        {
          deadline: Duration.millis(10),
          failureCopy,
          operation: "test.area-timeout",
          schema: Schema.toStandardSchemaV1(Schema.String),
        },
        () => Effect.never
      );
      const unexpected = defineWorkspaceAction(
        {
          failureCopy,
          operation: "test.area-unexpected",
          schema: Schema.toStandardSchemaV1(Schema.String),
        },
        () => Effect.die(new Error("Synthetic defect"))
      );
      actionRequestHeaders = { referer: `https://deskohub.test/${locale}` };

      await expect(timeout("input")).resolves.toEqual({
        serverError: failureCopy.timeout({}, { locale }),
      });
      await expect(unexpected("input")).resolves.toEqual({
        serverError: failureCopy.unexpected({}, { locale }),
      });
    });

    test("the fallback replaces a typed failure but not a defect, a timeout, or a public error", async () => {
      const { defineWorkspaceAction } = await import("./workspace-action");
      const { PublicSafeActionError } = await import(
        "../utils/safe-action-client"
      );
      const define = <E extends Error>(
        operation: string,
        handler: () => Effect.Effect<never, E>,
        deadline?: Duration.Input
      ) =>
        defineWorkspaceAction(
          {
            ...(deadline !== undefined && { deadline }),
            failureCopy,
            fallback,
            operation,
            schema: Schema.toStandardSchemaV1(Schema.String),
          },
          handler
        );
      const typedFailure = define("test.fallback-failure", () =>
        Effect.fail(new Error("Internal failure"))
      );
      const defect = define("test.fallback-defect", () =>
        Effect.die(new Error("Synthetic defect"))
      );
      const timeout = define(
        "test.fallback-timeout",
        () => Effect.never,
        Duration.millis(10)
      );
      const publicFailure = define("test.fallback-public", () =>
        Effect.fail(new PublicSafeActionError({ message: "Public failure" }))
      );
      actionRequestHeaders = { referer: `https://deskohub.test/${locale}` };

      await expect(typedFailure("input")).resolves.toEqual({
        serverError: fallback({}, { locale }),
      });
      await expect(defect("input")).resolves.toEqual({
        serverError: failureCopy.unexpected({}, { locale }),
      });
      await expect(timeout("input")).resolves.toEqual({
        serverError: failureCopy.timeout({}, { locale }),
      });
      await expect(publicFailure("input")).resolves.toEqual({
        serverError: "Public failure",
      });
    });
  });

  describe("failure logging", () => {
    const sensitiveValue = testEmailAddress("action-defect");
    let consoleError: ReturnType<typeof spyOn<Console, "error">>;

    beforeEach(() => {
      logExporter.reset();
      consoleError = spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      consoleError.mockRestore();
    });

    const defineFailingAction = (
      operation: string,
      handler: () => Effect.Effect<never, Error>,
      deadline?: Duration.Input
    ) =>
      import("./workspace-action").then(({ defineWorkspaceAction }) =>
        defineWorkspaceAction(
          {
            ...(deadline !== undefined && { deadline }),
            operation,
            schema: Schema.toStandardSchemaV1(Schema.String),
          },
          handler
        )
      );
    /** The "Action failed" records sent to PostHog. */
    const telemetryFailureLogs = (operation: string) =>
      logExporter
        .getFinishedLogRecords()
        .filter(
          ({ attributes, body }) =>
            attributes?.operation === operation && body === "Action failed"
        );
    /** The "Action failed" lines written to the console. */
    const consoleFailureLogs = (operation: string) =>
      consoleError.mock.calls
        .map((call) => call.join(" "))
        .filter(
          (line) => line.includes("Action failed") && line.includes(operation)
        );
    const expectRedacted = () => {
      expect(
        JSON.stringify(
          logExporter
            .getFinishedLogRecords()
            .map(({ attributes, body }) => ({ attributes, body }))
        )
      ).not.toContain(sensitiveValue);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        sensitiveValue
      );
    };
    const unexpected = {
      serverError: m.actionFailedUnexpectedly({}, { locale: "en-US" }),
    };

    test("logs a typed failure once", async () => {
      const action = await defineFailingAction("test.log-failure", () =>
        Effect.fail(new Error(`Internal failure for ${sensitiveValue}`))
      );

      await expect(action("input")).resolves.toEqual(unexpected);
      const [log, ...rest] = telemetryFailureLogs("test.log-failure");
      expect(rest).toHaveLength(0);
      expect(log?.attributes).toMatchObject({ failureKind: "failure" });
      expect(consoleFailureLogs("test.log-failure")).toHaveLength(1);
      expectRedacted();
    });

    test.each([
      [
        "an error",
        () => Effect.die(new TypeError(`Cannot render ${sensitiveValue}`)),
        "TypeError",
      ],
      [
        "a thrown string",
        () =>
          Effect.sync((): never => {
            throw `Cannot render ${sensitiveValue}`;
          }),
        undefined,
      ],
      [
        "a plain object",
        () => Effect.die({ attrs: { title: sensitiveValue } }),
        undefined,
      ],
    ])(
      "logs a defect from %s once with its cause redacted",
      async (_, handler, errorType) => {
        const action = await defineFailingAction("test.log-defect", handler);

        await expect(action("input")).resolves.toEqual(unexpected);
        const [log, ...rest] = telemetryFailureLogs("test.log-defect");
        expect(rest).toHaveLength(0);
        expect(log?.attributes).toMatchObject({
          boundary: "action",
          failureKind: "defect",
        });
        if (errorType)
          expect(String(log?.attributes?.cause)).toContain(errorType);
        expect(consoleFailureLogs("test.log-defect")).toHaveLength(1);
        expectRedacted();
      }
    );

    test("logs an interruption once", async () => {
      const action = await defineFailingAction(
        "test.log-interruption",
        () => Effect.interrupt
      );

      await expect(action("input")).resolves.toEqual(unexpected);
      const [log, ...rest] = telemetryFailureLogs("test.log-interruption");
      expect(rest).toHaveLength(0);
      expect(log?.attributes).toMatchObject({ failureKind: "interruption" });
      expect(consoleFailureLogs("test.log-interruption")).toHaveLength(1);
    });

    test("logs a handler interrupted at its deadline once", async () => {
      const action = await defineFailingAction(
        "test.log-deadline",
        () => Effect.never,
        Duration.millis(10)
      );

      await expect(action("input")).resolves.toEqual({
        serverError: m.actionTimedOut({}, { locale: "en-US" }),
      });
      const [log, ...rest] = telemetryFailureLogs("test.log-deadline");
      expect(rest).toHaveLength(0);
      expect(log?.attributes).toMatchObject({ failureKind: "interruption" });
      expect(consoleFailureLogs("test.log-deadline")).toHaveLength(1);
    });

    test("logs a header read interrupted at its deadline once", async () => {
      const action = await defineFailingAction(
        "test.log-setup-deadline",
        () => Effect.die(new Error("unreachable")),
        Duration.millis(10)
      );
      // The locale middleware's read settles; the action's own read hangs.
      actionHeaderReads = 0;
      overrideHeaderRead = (read) =>
        read > 1 ? new Promise<never>(() => {}) : undefined;

      await expect(action("input")).resolves.toEqual({
        serverError: m.actionTimedOut({}, { locale: "en-US" }),
      });
      const [log, ...rest] = telemetryFailureLogs("test.log-setup-deadline");
      expect(rest).toHaveLength(0);
      expect(log?.attributes).toMatchObject({
        boundary: "action",
        failureKind: "interruption",
      });
      expect(consoleFailureLogs("test.log-setup-deadline")).toHaveLength(1);
    });

    test("logs a failed header read once", async () => {
      const action = await defineFailingAction("test.log-setup-defect", () =>
        Effect.die(new Error("unreachable"))
      );
      // The locale middleware's read succeeds; the action's own read fails.
      actionHeaderReads = 0;
      overrideHeaderRead = (read) =>
        read > 1
          ? Promise.reject(new Error(`Header failure for ${sensitiveValue}`))
          : undefined;

      await expect(action("input")).resolves.toEqual(unexpected);
      const [log, ...rest] = telemetryFailureLogs("test.log-setup-defect");
      expect(rest).toHaveLength(0);
      expect(log?.attributes).toMatchObject({ failureKind: "defect" });
      expect(consoleFailureLogs("test.log-setup-defect")).toHaveLength(1);
      expectRedacted();
    });

    test("does not log Next.js control flow", async () => {
      const action = await defineFailingAction("test.log-redirect", () =>
        Effect.sync(() => redirect("/en-US"))
      );

      await expect(action("input")).rejects.toThrow("NEXT_REDIRECT");
      expect(telemetryFailureLogs("test.log-redirect")).toHaveLength(0);
      expect(consoleFailureLogs("test.log-redirect")).toHaveLength(0);
    });

    describe("inside a request's trace", () => {
      const spanExporter = new InMemorySpanExporter();
      const tracerProvider = new BasicTracerProvider({
        spanProcessors: [new SimpleSpanProcessor(spanExporter)],
      });
      const contextManager = new AsyncLocalStorageContextManager();

      beforeAll(() => {
        expect(
          context.setGlobalContextManager(contextManager.enable())
        ).toBeTrue();
        expect(trace.setGlobalTracerProvider(tracerProvider)).toBeTrue();
      });
      afterAll(async () => {
        trace.disable();
        context.disable();
        await tracerProvider.shutdown();
      });

      /** Calls `action` inside a span standing in for the request's. */
      const inRequestSpan = (action: () => Promise<unknown>) =>
        tracerProvider
          .getTracer("test")
          .startActiveSpan("POST /en-US", async (requestSpan) => {
            await action();
            requestSpan.end();
            return requestSpan.spanContext();
          });

      test("logs a failure in the action's span", async () => {
        const action = await defineFailingAction("test.log-trace", () =>
          Effect.die(new Error("synthetic"))
        );

        const requestSpan = await inRequestSpan(() => action("input"));

        const exportedActionSpan = spanExporter
          .getFinishedSpans()
          .find(({ name }) => name === "test.log-trace");
        const actionSpan = exportedActionSpan?.spanContext();
        const [log, ...rest] = telemetryFailureLogs("test.log-trace");
        expect(rest).toHaveLength(0);
        expect(exportedActionSpan?.parentSpanContext?.spanId).toBe(
          requestSpan.spanId
        );
        expect(log?.spanContext).toMatchObject({
          traceId: requestSpan.traceId,
          spanId: actionSpan?.spanId,
        });
        expect(log?.attributes).toMatchObject({
          "effect.trace_id": requestSpan.traceId,
          "effect.span_id": actionSpan?.spanId,
        });
      });

      test("logs a failure before the action ran in the request's trace", async () => {
        const action = await defineFailingAction("test.log-early-trace", () =>
          Effect.die(new Error("unreachable"))
        );
        failHeaderReads = true;

        const requestSpan = await inRequestSpan(() => action("input"));

        const [line, ...rest] = consoleFailureLogs("test.log-early-trace");
        expect(rest).toHaveLength(0);
        expect(line).toContain(`effect.trace_id=${requestSpan.traceId}`);
        expect(line).toContain(`effect.span_id=${requestSpan.spanId}`);
      });
    });

    test("logs a failure before the action ran once", async () => {
      const action = await defineFailingAction("test.log-early-failure", () =>
        Effect.die(new Error("unreachable"))
      );
      failHeaderReads = true;

      await expect(action("input")).resolves.toMatchObject({
        serverError: expect.any(String),
      });
      expect(consoleFailureLogs("test.log-early-failure")).toHaveLength(1);
    });
  });

  test("supports stateful form actions explicitly", async () => {
    const { defineWorkspaceStateAction } = await import("./workspace-action");
    const action = defineWorkspaceStateAction(
      {
        operation: "test.state-action",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
      },
      (input, _context, { prevResult }) =>
        Effect.succeed((prevResult.data ?? 0) + input)
    );

    await expect(action({ data: 1 }, "21")).resolves.toEqual({
      data: 22,
    });
  });
});
