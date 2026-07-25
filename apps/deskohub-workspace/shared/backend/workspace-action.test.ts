import { describe, expect, mock, spyOn, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  checkoutStatePrivacySentinels,
  makeAuthenticatedMalformedPayStateToken,
} from "@/features/checkout/backend/checkout/checkout-state-observability.test-utils";

let actionHeaderReads = 0;

mock.module("server-only", () => ({}));
mock.module("./bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => false,
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => {
    actionHeaderReads += 1;
    return new Headers({ referer: "https://deskohub.test/en-US" });
  },
}));

describe("Workspace actions", () => {
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
    expect(actionHeaderReads).toBe(3);
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
        operation: "test.checkout-state-failure",
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
        operation: "test.nested-cause-failure",
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
