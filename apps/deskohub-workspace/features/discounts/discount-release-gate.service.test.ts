import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  PostHogFeatureFlagEvaluationError,
  type TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import { type Context, Effect, Logger, References } from "effect";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type {
  PostHogFeatureFlagDefinitions,
  PostHogFeatureFlagKey,
} from "@/features/feature-flags/generated/contract";
import { runReactServerFixture } from "@/shared/testing/react-server-fixture.test-utils";
import { countWallClockReads } from "@/shared/testing/workspace-test-clock.test-utils";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

const flagValues = new Map<PostHogFeatureFlagKey, boolean | undefined>();
type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

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

// PostHog answers the opposite `calendar_sales` value on every call.
const flipCalendarSales = () =>
  evaluateFlags.mockImplementation(() =>
    Effect.sync(() => {
      flagValues.set("calendar_sales", !flagValues.get("calendar_sales"));
      return makeSnapshot();
    })
  );

const evaluateIn = (
  operation: "quote" | "affirm_displayed_discounts" | "apply_discount_code"
) =>
  DiscountReleaseGateService.pipe(
    Effect.flatMap((releaseGates) => releaseGates.evaluate({ operation }))
  );

// One Workspace run with its own build of the gate layer.
const runWithOwnLayer = <A>(
  effect: Effect.Effect<A, never, DiscountReleaseGateService>
) =>
  effect.pipe(
    Effect.provide(DiscountReleaseGateService.Default),
    Effect.provide(featureFlagLayer),
    Effect.runPromise
  );

describe("DiscountReleaseGateService", () => {
  beforeEach(() => {
    evaluateFlags.mockReset();
    evaluateFlags.mockImplementation(() => Effect.succeed(makeSnapshot()));
    flagValues.clear();
    flagValues.set("calendar_sales", true);
    flagValues.set("customer_discounts", true);
    flagValues.set("discount_codes", true);
  });

  test.each([
    ["calendar_sales", "calendarSales"],
    ["customer_discounts", "customerDiscounts"],
    ["discount_codes", "discountCodes"],
  ] as const)(
    "fails only %s closed when PostHog omits it",
    async (flag, gate) => {
      flagValues.delete(flag);
      const logRecords: {
        readonly annotations: LogAnnotations;
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
        return yield* releaseGates.evaluate({
          operation: "affirm_displayed_discounts",
        });
      }).pipe(
        Effect.provide(DiscountReleaseGateService.Default),
        Effect.provide(featureFlagLayer),
        Effect.provide(Logger.layer([logger])),
        Effect.runPromise
      );

      expect(result).toEqual({
        calendarSales: gate !== "calendarSales",
        customerDiscounts: gate !== "customerDiscounts",
        discountCodes: gate !== "discountCodes",
      });
      expect(logRecords).toEqual([
        {
          level: "Warn",
          annotations: expect.objectContaining({
            discountBoundary: "release_gate",
            discountOperation: "affirm_displayed_discounts",
            releaseGateFlags: [flag],
            releaseGateReason: "omitted",
          }),
        },
      ]);
      expect(JSON.stringify(logRecords)).not.toContain("SAVE20");
      expect(JSON.stringify(logRecords)).not.toContain("customer-1");
    }
  );

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
      readonly annotations: LogAnnotations;
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
      return yield* releaseGates.evaluate({
        operation: "discover_advertised_discounts",
      });
    }).pipe(
      Effect.provide(DiscountReleaseGateService.Default),
      Effect.provide(failingFeatureFlags),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(result).toEqual({
      calendarSales: false,
      customerDiscounts: false,
      discountCodes: false,
    });
    expect(logRecords).toEqual([
      {
        level: "Warn",
        annotations: expect.objectContaining({
          discountBoundary: "release_gate",
          discountOperation: "discover_advertised_discounts",
          releaseGateFlags: [
            "calendar_sales",
            "customer_discounts",
            "discount_codes",
          ],
          releaseGateReason: "evaluation_failed",
        }),
      },
    ]);
    expect(JSON.stringify(logRecords)).not.toContain("private provider cause");
  });

  test("decides once for sequential operations of one run", async () => {
    flipCalendarSales();

    const decisions = await runWithOwnLayer(
      Effect.all([
        evaluateIn("quote"),
        evaluateIn("affirm_displayed_discounts"),
        evaluateIn("apply_discount_code"),
      ])
    );

    expect(new Set(decisions.map((gates) => gates.calendarSales)).size).toBe(1);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("decides once for concurrent operations of one run", async () => {
    flipCalendarSales();

    const decisions = await runWithOwnLayer(
      Effect.all(
        [
          evaluateIn("quote"),
          evaluateIn("affirm_displayed_discounts"),
          evaluateIn("apply_discount_code"),
        ],
        { concurrency: "unbounded" }
      )
    );

    expect(new Set(decisions.map((gates) => gates.calendarSales)).size).toBe(1);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("decides without reading the wall clock, so Next.js can prerender it", async () => {
    flagValues.set("calendar_sales", true);

    const { value, wallClockReads } = await runWithOwnLayer(
      countWallClockReads(
        Effect.all([evaluateIn("quote"), evaluateIn("apply_discount_code")])
      )
    );

    expect(value.map((gates) => gates.calendarSales)).toEqual([true, true]);
    expect(wallClockReads).toBe(0);
  });

  test("keeps a failed evaluation closed for the run without retrying", async () => {
    evaluateFlags.mockImplementation(() =>
      evaluateFlags.mock.calls.length === 1
        ? Effect.fail(
            new PostHogFeatureFlagEvaluationError({
              message: "Evaluation failed.",
              cause: undefined,
            })
          )
        : Effect.succeed(makeSnapshot())
    );

    const decisions = await runWithOwnLayer(
      Effect.all([evaluateIn("quote"), evaluateIn("apply_discount_code")])
    );

    expect(decisions).toEqual([
      { calendarSales: false, customerDiscounts: false, discountCodes: false },
      { calendarSales: false, customerDiscounts: false, discountCodes: false },
    ]);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("shares decisions within real React server renders", async () => {
    const { exitCode, output } = await runReactServerFixture(
      "./features/discounts/discount-release-gate.service.rsc-fixture.ts"
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("4 pass");
    expect(output).toContain("DISCOUNT_RELEASE_GATE_REACT_SERVER_PROOF");
  });
});
