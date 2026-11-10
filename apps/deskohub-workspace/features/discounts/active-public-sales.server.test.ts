import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer, Logger } from "effect";
import {
  type IWorkspaceFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";
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
// Resolves once the render reaches request time; a prerender never does.
let requestStarts: Promise<void> = Promise.resolve();
const connection = mock(() => requestStarts);
// The `calendar_sales` release for every visitor; PostHog decides an
// undecided one per visitor.
let calendarSalesRelease: GlobalRelease = "undecided";
const loadGlobalRelease = mock(() => Promise.resolve(calendarSalesRelease));
mock.module("@/features/feature-flags/backend/global-release.server", () => ({
  loadGlobalRelease,
}));
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
  evaluateFlags: IWorkspaceFeatureFlagService["evaluateFlags"]
) => {
  Object.assign(DiscountReleaseGateService, {
    Live: DiscountReleaseGateService.Default.pipe(
      Layer.provide(
        Layer.succeed(WorkspaceFeatureFlagService, {
          evaluateFlags,
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
  requestStarts = Promise.resolve();
  calendarSalesRelease = "undecided";
  loadGlobalRelease.mockClear();
  connection.mockClear();
  discoverActiveSales.mockClear();
  logRecords.length = 0;
});

describe("getActivePublicSales", () => {
  test("answers no sales without the request while calendar sales are off for everyone", async () => {
    calendarSalesRelease = "off";
    const evaluateFlags = mock(() =>
      Effect.die("evaluateFlags should not be called")
    );
    installFeatureFlags(evaluateFlags);

    await expect(
      Effect.runPromise(getActivePublicSales({ locale: "en-US" }))
    ).resolves.toEqual([]);

    expect(loadGlobalRelease).toHaveBeenCalledWith("calendar_sales");
    expect(connection).not.toHaveBeenCalled();
    expect(evaluateFlags).not.toHaveBeenCalled();
    expect(discoverActiveSales).not.toHaveBeenCalled();
  });

  test("asks PostHog about the visitor only at request time", async () => {
    // posthog-node reads the clock before its request, which Next.js reports
    // as an error while prerendering (#1187).
    const { promise: requestTime, resolve: startRequest } =
      Promise.withResolvers<void>();
    requestStarts = requestTime;
    const evaluateFlags = mock(() => Effect.fail(evaluationError()));
    installFeatureFlags(evaluateFlags);

    const sales = Effect.runPromise(getActivePublicSales({ locale: "en-US" }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(connection).toHaveBeenCalledTimes(1);
    expect(evaluateFlags).not.toHaveBeenCalled();

    startRequest();
    await expect(sales).resolves.toEqual([]);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("fails closed without provider work and logs evaluation failures", async () => {
    const evaluateFlags = mock(() => Effect.fail(evaluationError()));
    installFeatureFlags(evaluateFlags);

    await expect(
      Effect.runPromise(
        getActivePublicSales({ locale: "en-US" }).pipe(
          Effect.provide(Logger.layer([logger]))
        )
      )
    ).resolves.toEqual([]);

    expect(evaluateFlags).toHaveBeenCalledWith({
      flagKeys: ["calendar_sales", "customer_discounts", "discount_codes"],
    });
    expect(discoverActiveSales).not.toHaveBeenCalled();
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Release gate unavailable; it stays closed",
    });
  });
});
