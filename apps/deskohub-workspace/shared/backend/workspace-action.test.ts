<<<<<<< HEAD
import { describe, expect, mock, spyOn, test } from "bun:test";
=======
import { afterEach, describe, expect, jest, mock, test } from "bun:test";
>>>>>>> 71b705cb2396074a4a58813c2ab71fc15f9514df
import { Effect, Schema } from "effect";
import {
  checkoutStatePrivacySentinels,
  makeAuthenticatedMalformedPayStateToken,
} from "@/features/checkout/backend/checkout/checkout-state-observability.test-utils";

let actionHeaderReads = 0;
let botIdEnforced = false;
const checkBotId = mock(() => Promise.resolve({ isBot: false }));

mock.module("server-only", () => ({}));
mock.module("./bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => botIdEnforced,
}));
mock.module("botid/server", () => ({
  checkBotId,
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => {
    actionHeaderReads += 1;
    return new Headers({ referer: "https://deskohub.test/en-US" });
  },
}));

afterEach(() => {
  actionHeaderReads = 0;
  botIdEnforced = false;
  checkBotId.mockClear();
  checkBotId.mockImplementation(() => Promise.resolve({ isBot: false }));
});

describe("Workspace actions", () => {
  test("starts the lifecycle after validation and provides Bot protection", async () => {
    const { BotProtectionService } = await import(
      "./bot-protection/bot-protection.service"
    );
    const { defineWorkspaceAction } = await import("./workspace-action");
    actionHeaderReads = 0;
    let handlerConstructions = 0;
    const action = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
      },
      (input, context) => {
        handlerConstructions += 1;
        return Effect.map(BotProtectionService, () => ({
          clientInput: context.clientInput,
          locale: context.locale,
          value: input * 2,
        }));
      }
    );

    await expect(action("invalid")).resolves.toMatchObject({
      validationErrors: expect.any(Object),
    });
    // The locale middleware reads once before validation; the action lifecycle
    // must not add its own request-context read for invalid input.
    expect(actionHeaderReads).toBe(1);
    expect(handlerConstructions).toBe(0);

    await expect(action("21")).resolves.toEqual({
      data: { clientInput: "21", locale: "en-US", value: 42 },
    });
    expect(actionHeaderReads).toBe(3);
    expect(handlerConstructions).toBe(1);
  });

  test("preserves public failures", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const { PublicSafeActionError } = await import(
      "../utils/safe-action-client"
    );
    const action = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(new PublicSafeActionError({ message: "Public failure" }))
    );

    await expect(action("input")).resolves.toEqual({
      serverError: "Public failure",
    });
  });

  test("preserves only genuinely branded nested public failures", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const { PublicSafeActionError } = await import(
      "../utils/safe-action-client"
    );
    const { DEFAULT_SERVER_ERROR_MESSAGE } = await import("next-safe-action");
    const genuine = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(
          new Error("internal wrapper", {
            cause: new PublicSafeActionError({
              message: "Genuine public failure",
            }),
          })
        )
    );
    const forgedSentinels = [
      "SYNTHETIC-FORGED-PLAIN-MESSAGE",
      "SYNTHETIC-FORGED-NESTED-MESSAGE",
      "SYNTHETIC-FORGED-AGGREGATE-MESSAGE",
      "SYNTHETIC-FORGED-CUSTOM-MESSAGE",
      "SYNTHETIC-FORGED-PROTOTYPE-MESSAGE",
      "SYNTHETIC-FORGED-CYCLIC-MESSAGE",
    ] as const;
    const cyclicForgery: {
      readonly _tag: "PublicSafeActionError";
      readonly message: string;
      cause?: unknown;
    } = {
      _tag: "PublicSafeActionError",
      message: forgedSentinels[5],
    };
    cyclicForgery.cause = cyclicForgery;
    const prototypeForgery = Object.create(PublicSafeActionError.prototype) as {
      message: string;
    };
    prototypeForgery.message = forgedSentinels[4];
    const forgedValues = [
      {
        _tag: "PublicSafeActionError",
        message: forgedSentinels[0],
      },
      new Error("custom wrapper", {
        cause: {
          _tag: "PublicSafeActionError",
          message: forgedSentinels[1],
        },
      }),
      new AggregateError(
        [
          {
            _tag: "PublicSafeActionError",
            message: forgedSentinels[2],
          },
        ],
        "aggregate wrapper"
      ),
      new (class extends Error {
        readonly _tag = "PublicSafeActionError";
      })(forgedSentinels[3]),
      prototypeForgery,
      cyclicForgery,
    ];
    const errorLog = spyOn(console, "error").mockImplementation(
      () => undefined
    );

    try {
      await expect(genuine("input")).resolves.toEqual({
        serverError: "Genuine public failure",
      });
      for (const forged of forgedValues) {
        const action = defineWorkspaceAction(
          {
            operation: "contact.submit",
            schema: Schema.toStandardSchemaV1(Schema.String),
          },
          () => Effect.fail(forged)
        );
        const result = await action("input");
        expect(result).toEqual({
          serverError: DEFAULT_SERVER_ERROR_MESSAGE,
        });
      }

      const consoleOutput = JSON.stringify(errorLog.mock.calls);
      for (const sentinel of forgedSentinels) {
        expect(consoleOutput).not.toContain(sentinel);
      }
    } finally {
      errorLog.mockRestore();
    }
  });

  test("keeps authenticated malformed checkout state out of action console errors", async () => {
    const { openPayState } = await import(
      "@/features/checkout/backend/checkout/pay-state"
    );
    const { defineWorkspaceAction } = await import("./workspace-action");
    const errorLog = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const payStateToken = makeAuthenticatedMalformedPayStateToken();
    const action = defineWorkspaceAction(
      {
        operation: "checkout.prepare-pay-state",
        schema: Schema.toStandardSchemaV1(
          Schema.Struct({ payStateToken: Schema.NonEmptyString })
        ),
      },
      (input) => openPayState(input.payStateToken)
    );

    try {
      const result = await action({ payStateToken });
      const output = JSON.stringify(errorLog.mock.calls);

      expect(result).toHaveProperty("serverError");
      expect(output).not.toContain(payStateToken);
      for (const sentinel of Object.values(checkoutStatePrivacySentinels)) {
        expect(output).not.toContain(sentinel);
      }
    } finally {
      errorLog.mockRestore();
    }
  });

  test("keeps arbitrary nested causes out of framework responses and console errors", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const errorLog = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const sentinel = "SYNTHETIC-SENSITIVE-SENTINEL";
    const action = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(
          new AggregateError(
            [
              sentinel,
              {
                _tag: "SyntheticCause",
                customerId: sentinel,
                cause: new Error(sentinel),
              },
            ],
            sentinel
          )
        )
    );

    try {
      const result = await action("synthetic-input");
      const emitted = JSON.stringify({ result, logs: errorLog.mock.calls });

      expect(result).toHaveProperty("serverError");
      expect(emitted).not.toContain(sentinel);
      expect(emitted).not.toContain("customerId");
    } finally {
      errorLog.mockRestore();
    }
  });

  test("normalizes synchronous and asynchronous framework defects", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const sentinel = "SYNTHETIC-FRAMEWORK-DEFECT";
    const errorLog = spyOn(console, "error").mockImplementation(
      () => undefined
    );
    const syncAction = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => {
        throw new Error(sentinel);
      }
    );
    const asyncAction = defineWorkspaceAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.promise(() => Promise.reject(new Error(sentinel)))
    );

    try {
      const results = await Promise.all([
        syncAction("synthetic-input"),
        asyncAction("synthetic-input"),
      ]);
      const emitted = JSON.stringify({ results, logs: errorLog.mock.calls });

      for (const result of results) {
        expect(result).toHaveProperty("serverError");
      }
      expect(emitted).not.toContain(sentinel);
    } finally {
      errorLog.mockRestore();
    }
  });

  test("supports stateful form actions explicitly", async () => {
    const { defineWorkspaceStateAction } = await import("./workspace-action");
    const action = defineWorkspaceStateAction(
      {
        operation: "contact.submit",
        schema: Schema.toStandardSchemaV1(Schema.FiniteFromString),
      },
      (input, _context, { prevResult }) => {
        const previousValue =
          typeof prevResult.data === "number" ? prevResult.data : 0;
        return Effect.succeed(previousValue + input);
      }
    );

    await expect(action({ data: 1 }, "21")).resolves.toEqual({
      data: 22,
    });
  });

  test("provides the live BotID capability without changing its call contract", async () => {
    const { BotProtectionService } = await import(
      "./bot-protection/bot-protection.service"
    );
    const { defineWorkspaceAction } = await import("./workspace-action");
    botIdEnforced = true;
    const action = defineWorkspaceAction(
      {
        operation: "test.botid",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        BotProtectionService.pipe(
          Effect.flatMap(({ verifyHuman }) =>
            verifyHuman({ verificationFailurePolicy: "deny" })
          ),
          Effect.as("verified")
        )
    );

    await expect(action("input")).resolves.toEqual({ data: "verified" });
    expect(checkBotId).toHaveBeenCalledTimes(1);
    expect(checkBotId).toHaveBeenCalledWith();
  });

  test("keeps internal failures and synchronous defects private", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const failureDetail = "private expected failure";
    const failureAction = defineWorkspaceAction(
      {
        operation: "test.private-failure",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.fail(new Error(failureDetail))
    );
    const defectDetail = "private construction defect";
    const defectAction = defineWorkspaceAction(
      {
        operation: "test.private-defect",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => {
        throw new Error(defectDetail);
      }
    );

    const failureResult = await failureAction("input");
    const defectResult = await defectAction("input");

    expect(failureResult).toMatchObject({ serverError: expect.any(String) });
    expect(defectResult).toMatchObject({ serverError: expect.any(String) });
    expect(JSON.stringify(failureResult)).not.toContain(failureDetail);
    expect(JSON.stringify(defectResult)).not.toContain(defectDetail);
  });

  test("times out only the action invocation after 45 seconds", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    jest.useFakeTimers();
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const action = defineWorkspaceAction(
      {
        operation: "test.timeout",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.sync(markStarted).pipe(Effect.andThen(Effect.never))
    );

    try {
      let settled = false;
      const result = action("input").then((value) => {
        settled = true;
        return value;
      });
      await started;

      jest.advanceTimersByTime(44_999);
      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      await expect(result).resolves.toEqual({
        serverError: "Request timed out. Please try again.",
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
