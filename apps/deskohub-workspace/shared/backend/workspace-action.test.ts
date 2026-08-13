import { describe, expect, mock, spyOn, test } from "bun:test";
import { Effect, Schema } from "effect";

let actionHeaderReads = 0;
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
    const sensitiveKey = "person@example.test";
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

  test("schedules a telemetry flush for validation failures", async () => {
    const { registerPostHogLoggerProvider } = await import(
      "./logging/posthog-otel"
    );
    const { defineWorkspaceAction } = await import("./workspace-action");
    const provider: NonNullable<
      Parameters<typeof registerPostHogLoggerProvider>[0]
    > = {
      forceFlush: () => Promise.resolve(),
    };
    const action = defineWorkspaceAction(
      {
        operation: "test.validation-flush",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () => Effect.succeed("unreachable")
    );
    scheduledTelemetryFlushes = 0;
    registerPostHogLoggerProvider(provider);

    try {
      await expect(action(42)).resolves.toMatchObject({
        validationErrors: expect.any(Object),
      });
      expect(scheduledTelemetryFlushes).toBe(1);
    } finally {
      registerPostHogLoggerProvider(undefined);
    }
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
      serverError: "Something went wrong while executing the operation.",
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
