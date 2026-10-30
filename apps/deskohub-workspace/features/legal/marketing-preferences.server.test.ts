import "@/shared/testing/workspace-test-env";

import { afterAll, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
  MarketingPreferences,
  MarketingPreferencesMutationError,
} from "./backend/marketing-preferences.service";

mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect: () => (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(effect),
}));
const originalLive = MarketingPreferences.Live;
MarketingPreferences.Live = Layer.mock(MarketingPreferences, {
  read: Effect.fail(MarketingPreferencesMutationError.unavailable()),
});
afterAll(() => {
  MarketingPreferences.Live = originalLive;
});
const { getMarketingPreferences } = await import(
  "./marketing-preferences.server"
);

test("page edge reduces a request-cookie or ledger failure to the closed public state", async () => {
  expect(await getMarketingPreferences("en-US")).toEqual({
    status: "unavailable",
  });
});
