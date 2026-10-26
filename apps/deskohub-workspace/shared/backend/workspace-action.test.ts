import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Duration, Effect, Schema } from "effect";
import { m as administrationMessages } from "@/features/administration/i18n";
import { type Locale, m } from "@/features/i18n";

let actionHeaderReads = 0;
let actionRequestHeaders: Record<string, string> = {};
let failHeaderReads = false;
let scheduledTelemetryFlushes = 0;

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
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => {
    actionHeaderReads += 1;
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
      "reports a run that rejects before the Effect starts in %s",
      async (locale) => {
        const { createWorkspaceActionClient } = await import(
          "../utils/safe-action-client"
        );
        const action = createWorkspaceActionClient(
          m.actionFailedUnexpectedly
        ).action(() => Promise.reject(new Error("Runtime could not start")));
        requestFrom(locale);

        await expect(action()).resolves.toEqual({
          serverError: m.actionFailedUnexpectedly({}, { locale }),
        });
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
