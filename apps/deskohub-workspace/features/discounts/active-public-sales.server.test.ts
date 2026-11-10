import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer, Logger, Result } from "effect";
import {
  type IWorkspaceFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import { ReleaseGateUnavailableError } from "@/features/feature-flags/backend/release-gate";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

type LogRecord = {
  readonly level: string;
  readonly message: unknown;
};

const logRecords: LogRecord[] = [];
const logger = Logger.make((options) => {
  logRecords.push({
    level: options.logLevel,
    message: options.message[0],
  });
});
const connection = mock(() => Promise.resolve());
const discoverActiveSales = mock(() =>
  Effect.die("provider should not be called")
);

mock.module("next/server", () => ({ connection }));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect.pipe(Effect.provide(Logger.layer([logger])))),
}));

const CalendarDiscountProvider = Context.Service<
  CalendarDiscountProvider,
  { readonly discoverActiveSales: typeof discoverActiveSales }
>()("@test/CalendarDiscountProvider");
Object.assign(CalendarDiscountProvider, {
  Live: Layer.succeed(CalendarDiscountProvider, { discoverActiveSales }),
});
mock.module("./calendar-discount-provider.service", () => ({
  CalendarDiscountProvider,
}));

const { getActivePublicSales } = await import("./active-public-sales.server");

const originalGatesLive = DiscountReleaseGateService.Live;

const installFeatureFlags = (
  decision: IWorkspaceFeatureFlagService["decision"]
) => {
  Object.assign(DiscountReleaseGateService, {
    Live: DiscountReleaseGateService.Default.pipe(
      Layer.provide(
        Layer.succeed(WorkspaceFeatureFlagService, {
          // The banner can be stored in the home page's shell, so it reads
          // the gates' decision for stored output only.
          decision,
          evaluateFlags: () => Effect.die("evaluateFlags should not be called"),
          isEnabled: () => Effect.die("isEnabled should not be called"),
          constantValue: () => Effect.die("constantValue should not be called"),
        })
      )
    ),
  });
};

const evaluationError = () =>
  new PostHogFeatureFlagEvaluationError({
    message: "Could not evaluate the PostHog feature flag.",
    cause: undefined,
  });

afterAll(() => {
  Object.assign(DiscountReleaseGateService, { Live: originalGatesLive });
});

afterEach(() => {
  connection.mockClear();
  discoverActiveSales.mockClear();
  logRecords.length = 0;
});

const activeSales = () =>
  Effect.runPromise(
    getActivePublicSales({ locale: "en-US" }).pipe(
      Effect.provide(Logger.layer([logger])),
      Effect.result
    )
  );

describe("getActivePublicSales", () => {
  test("fails without request or provider work while PostHog can't decide the gates, and logs it", async () => {
    const decision = mock(() => Effect.fail(evaluationError()));
    installFeatureFlags(decision);

    const result = await activeSales();

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ReleaseGateUnavailableError);
      expect(result.failure.flags).toEqual([
        "calendar_sales",
        "customer_discounts",
        "discount_codes",
      ]);
    }
    expect(decision).toHaveBeenCalledWith("calendar_sales");
    expect(connection).not.toHaveBeenCalled();
    expect(discoverActiveSales).not.toHaveBeenCalled();
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Release gate unavailable; the read fails",
    });
  });

  test("answers no sales without request or provider work while the sale gate is off", async () => {
    installFeatureFlags((key) => Effect.succeed(key !== "calendar_sales"));

    const result = await activeSales();

    expect(result).toEqual(Result.succeed([]));
    expect(connection).not.toHaveBeenCalled();
    expect(discoverActiveSales).not.toHaveBeenCalled();
  });
});
