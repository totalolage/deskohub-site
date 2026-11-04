import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, mock, test } from "bun:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Layer } from "effect";
import {
  MarketingPreferences,
  MarketingPreferencesMutationError,
} from "./backend/marketing-preferences.service";

type ActionInput = { readonly context: string } & Partial<{
  readonly source: "account" | "link";
  readonly granted: boolean;
  readonly confirmed: boolean;
  readonly locale: "en-US" | "cs-CZ";
}>;

const unexpected = "Unexpected action failure";
const options: { operation: string; logInput?: boolean }[] = [];
mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction: (
    config: {
      operation: string;
      logInput?: boolean;
      schema: StandardSchemaV1<ActionInput>;
    },
    handler: (input: ActionInput) => Effect.Effect<unknown>
  ) => {
    options.push(config);
    return async (input: ActionInput) => {
      const parsed = await config.schema["~standard"].validate(input);
      if (parsed.issues) return { validationErrors: parsed.issues };
      const result = await Effect.runPromise(
        handler(parsed.value).pipe(Effect.result)
      );
      return result._tag === "Failure"
        ? { serverError: unexpected }
        : { data: result.success };
    };
  },
}));

let unavailable = false;
const save = mock((input: ActionInput) =>
  Effect.succeed({ status: "saved", input })
);
const confirm = mock((input: ActionInput) =>
  Effect.succeed({ status: "confirmed", input })
);
const clear = mock((_input: ActionInput) =>
  unavailable
    ? Effect.fail(MarketingPreferencesMutationError.unavailable())
    : Effect.succeed({ status: "rejected", reason: "stale-context" })
);
const originalLive = MarketingPreferences.Live;
const originalManagementLive = MarketingPreferences.ManagementLive;
const fake = Layer.mock(MarketingPreferences, { save, confirm, clear });
MarketingPreferences.Live = fake;
MarketingPreferences.ManagementLive = fake;
afterAll(() => {
  MarketingPreferences.Live = originalLive;
  MarketingPreferences.ManagementLive = originalManagementLive;
});
const {
  saveMarketingPreferencesAction,
  confirmMarketingManagementAction,
  clearMarketingManagementAction,
} = await import("./actions");

describe("marketing Server Action edges", () => {
  test("keeps strict form inputs and forwards each action through one runtime edge", async () => {
    const input = {
      source: "account",
      context: "opaque-context",
      granted: true,
      confirmed: true,
      locale: "en-US",
    } as const;
    expect(await saveMarketingPreferencesAction(input)).toEqual({
      data: { status: "saved", input },
    });
    const context = { context: "opaque-context" };
    expect(await confirmMarketingManagementAction(context)).toEqual({
      data: { status: "confirmed", input: context },
    });
    expect(await clearMarketingManagementAction(context)).toEqual({
      data: { status: "rejected", reason: "stale-context" },
    });
    expect(
      options.map(({ operation, logInput }) => ({ operation, logInput }))
    ).toEqual([
      { operation: "legal.marketing-preferences.save", logInput: false },
      { operation: "legal.marketing-preferences.confirm", logInput: false },
      { operation: "legal.marketing-preferences.clear", logInput: false },
    ]);
    for (const invalid of [
      { ...input, confirmed: false },
      { ...input, context: "" },
      { ...input, customerId: "browser-customer" },
    ]) {
      expect(await saveMarketingPreferencesAction(invalid)).toHaveProperty(
        "validationErrors"
      );
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  test("leaves unavailable dependencies to the runtime's unexpected copy", async () => {
    unavailable = true;
    expect(
      await clearMarketingManagementAction({ context: "opaque-context" })
    ).toEqual({ serverError: unexpected });
  });
});
