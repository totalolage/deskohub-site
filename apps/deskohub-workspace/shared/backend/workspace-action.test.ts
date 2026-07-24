import { describe, expect, mock, spyOn, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { Cause, Effect, Schema } from "effect";

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

  test("censors nested provider Causes before action failure logging", async () => {
    const { defineWorkspaceAction } = await import("./workspace-action");
    const { PublicSafeActionError } = await import(
      "../utils/safe-action-client"
    );
    const marker = "synthetic-sensitive-action-marker";
    const errorOutput: unknown[][] = [];
    const consoleError = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errorOutput.push(args);
      }
    );
    const action = defineWorkspaceAction(
      {
        operation: "test.censored-provider-failure",
        schema: Schema.toStandardSchemaV1(Schema.String),
      },
      () =>
        Effect.fail(
          new PublicSafeActionError({
            message: "Safe public failure",
            cause: Cause.fail(
              new ExternalAPIError({
                service: "Dotypos",
                operation: "createReservation",
                message: marker,
                providerError: { errorDescription: marker },
                cause: new Error(marker),
              })
            ),
          })
        )
    );

    try {
      await expect(action("input")).resolves.toEqual({
        serverError: "Safe public failure",
      });
      expect(JSON.stringify(errorOutput)).not.toContain(marker);
      expect(JSON.stringify(errorOutput)).toContain("PublicSafeActionError");
    } finally {
      consoleError.mockRestore();
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
