import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import { Effect, Schema } from "effect";

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
        operation: "test.action",
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

  test("supports stateful form actions explicitly", async () => {
    const { defineWorkspaceStateAction } = await import("./workspace-action");
    const action = defineWorkspaceStateAction(
      {
        operation: "test.state-action",
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
