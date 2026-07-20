import "@/shared/testing/workspace-test-env";

import { expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { DiscountReleaseGateEvaluator } from "./discount-release-gate.service";

const evaluateFlags = mock(() =>
  Effect.succeed({
    getFlag: (key: string) => key === "calendar_sales",
  })
);

mock.module("@/features/feature-flags/backend/node", () => ({
  nodeFeatureFlags: { evaluateFlags },
}));

mock.module("@/features/feature-flags/backend/subject", () => ({
  getCurrentPostHogFeatureFlagSubject: () =>
    Effect.succeed({
      distinctId: "deskohub-workspace:global-release",
      sendFeatureFlagEvents: false,
    }),
}));

test("evaluates one batched snapshot for the current request subject", async () => {
  const { DiscountReleaseGateEvaluatorLive } = await import(
    "./discount-release-gate.server"
  );

  const snapshot = await Effect.gen(function* () {
    const evaluator = yield* DiscountReleaseGateEvaluator;
    return yield* evaluator.evaluate();
  }).pipe(Effect.provide(DiscountReleaseGateEvaluatorLive), Effect.runPromise);

  expect(evaluateFlags).toHaveBeenCalledTimes(1);
  expect(evaluateFlags).toHaveBeenCalledWith({
    options: {
      flagKeys: ["calendar_sales", "customer_discounts", "discount_codes"],
    },
    subject: {
      distinctId: "deskohub-workspace:global-release",
      sendFeatureFlagEvents: false,
    },
  });
  expect(snapshot.getFlag("calendar_sales")).toBeTrue();
  expect(snapshot.getFlag("customer_discounts")).toBeFalse();
});
