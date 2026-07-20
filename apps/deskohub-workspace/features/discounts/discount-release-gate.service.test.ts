import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  PostHogFeatureFlagEvaluationError,
  type TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import { Effect, Logger, References } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type {
  PostHogFeatureFlagDefinitions,
  PostHogFeatureFlagKey,
} from "@/features/feature-flags/generated/contract";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

const flagValues = new Map<PostHogFeatureFlagKey, boolean | undefined>();

const makeSnapshot = () =>
  ({
    getFlag: (key) => flagValues.get(key),
    getFlagPayload: () => undefined,
    isEnabled: (key) => flagValues.get(key) === true,
    raw: {
      getFlag: (key) => flagValues.get(key as PostHogFeatureFlagKey),
      getFlagPayload: () => undefined,
      isEnabled: (key) => flagValues.get(key as PostHogFeatureFlagKey) === true,
    },
  }) satisfies TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>;

const evaluateFlags = mock(() => Effect.succeed(makeSnapshot()));

const featureFlagLayer = WorkspaceFeatureFlagServiceMock({
  evaluateFlags,
});

const runGateEvaluation = () =>
  Effect.gen(function* () {
    const releaseGates = yield* DiscountReleaseGateService;
    return yield* releaseGates.evaluate({ operation: "quote" });
  }).pipe(
    Effect.provide(DiscountReleaseGateService.Live),
    Effect.provide(featureFlagLayer),
    Effect.runPromise
  );

describe("DiscountReleaseGateService", () => {
  beforeEach(() => {
    evaluateFlags.mockClear();
    flagValues.clear();
    flagValues.set("calendar_sales", true);
    flagValues.set("customer_discounts", true);
    flagValues.set("discount_codes", true);
  });

  test("evaluates one snapshot for all discount gates", async () => {
    const result = await runGateEvaluation();

    expect(result).toEqual({
      calendarSales: true,
      customerDiscounts: true,
      discountCodes: true,
    });
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("treats explicit false values as disabled without an error", async () => {
    flagValues.set("calendar_sales", false);
    flagValues.set("customer_discounts", false);
    flagValues.set("discount_codes", false);
    const logLevels: string[] = [];
    const logger = Logger.make((options) => {
      logLevels.push(options.logLevel);
    });

    const result = await Effect.gen(function* () {
      const releaseGates = yield* DiscountReleaseGateService;
      return yield* releaseGates.evaluate({ operation: "quote" });
    }).pipe(
      Effect.provide(DiscountReleaseGateService.Live),
      Effect.provide(featureFlagLayer),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(result).toEqual({
      calendarSales: false,
      customerDiscounts: false,
      discountCodes: false,
    });
    expect(logLevels).not.toContain("Error");
  });

  test.each([
    ["calendar_sales", "calendarSales"],
    ["customer_discounts", "customerDiscounts"],
    ["discount_codes", "discountCodes"],
  ] as const)("fails only %s closed when PostHog omits it", async (flag, gate) => {
    flagValues.delete(flag);
    const logRecords: {
      readonly annotations: Record<string, unknown>;
      readonly level: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
      });
    });

    const result = await Effect.gen(function* () {
      const releaseGates = yield* DiscountReleaseGateService;
      return yield* releaseGates.evaluate({ operation: "affirm" });
    }).pipe(
      Effect.provide(DiscountReleaseGateService.Live),
      Effect.provide(featureFlagLayer),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(result).toEqual({
      calendarSales: gate !== "calendarSales",
      customerDiscounts: gate !== "customerDiscounts",
      discountCodes: gate !== "discountCodes",
    });
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "release_gate",
        discountOperation: "affirm",
        discountFeatureFlag: flag,
        discountErrorTag: "MissingFeatureFlag",
        discountErrorReason: "missing_flag",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("SAVE20");
    expect(JSON.stringify(logRecords)).not.toContain("customer-1");
  });

  test("fails every gate closed when evaluation fails", async () => {
    const failingFeatureFlags = WorkspaceFeatureFlagServiceMock({
      evaluateFlags: () =>
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Evaluation failed.",
            cause: new Error("private provider cause"),
          })
        ),
    });
    const logRecords: {
      readonly annotations: Record<string, unknown>;
      readonly level: string;
    }[] = [];
    const logger = Logger.make((options) => {
      logRecords.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
      });
    });

    const result = await Effect.gen(function* () {
      const releaseGates = yield* DiscountReleaseGateService;
      return yield* releaseGates.evaluate({ operation: "quote" });
    }).pipe(
      Effect.provide(DiscountReleaseGateService.Live),
      Effect.provide(failingFeatureFlags),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(result).toEqual({
      calendarSales: false,
      customerDiscounts: false,
      discountCodes: false,
    });
    expect(logRecords).toContainEqual({
      level: "Error",
      annotations: expect.objectContaining({
        discountBoundary: "release_gate",
        discountOperation: "quote",
        discountErrorTag: "PostHogFeatureFlagEvaluationError",
        discountErrorReason: "evaluation_failure",
      }),
    });
    expect(JSON.stringify(logRecords)).not.toContain("private provider cause");
  });
});
