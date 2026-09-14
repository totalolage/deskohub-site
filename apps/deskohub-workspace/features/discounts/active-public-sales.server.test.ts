import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer, Logger } from "effect";
import {
  type IWorkspaceFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";

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

const originalDefault = WorkspaceFeatureFlagService.Default;

const installFeatureFlagDefault = (
  isEnabled: IWorkspaceFeatureFlagService["isEnabled"]
) => {
  Object.assign(WorkspaceFeatureFlagService, {
    Default: Layer.succeed(WorkspaceFeatureFlagService, {
      evaluateFlags: () => Effect.die("evaluateFlags should not be called"),
      isEnabled,
    }),
  });
};

const evaluationError = () =>
  new PostHogFeatureFlagEvaluationError({
    message: "Could not evaluate the PostHog feature flag.",
    cause: undefined,
  });

afterAll(() => {
  Object.assign(WorkspaceFeatureFlagService, { Default: originalDefault });
});

afterEach(() => {
  connection.mockClear();
  discoverActiveSales.mockClear();
  logRecords.length = 0;
});

describe("getActivePublicSales", () => {
  test("returns no sales without request or provider work when disabled", async () => {
    const isEnabled = mock(() => Effect.succeed(false));
    installFeatureFlagDefault(isEnabled);

    await expect(
      Effect.runPromise(
        getActivePublicSales({ locale: "en-US" }).pipe(
          Effect.provide(Logger.layer([logger]))
        )
      )
    ).resolves.toEqual([]);

    expect(isEnabled).toHaveBeenCalledWith("calendar_sales");
    expect(connection).not.toHaveBeenCalled();
    expect(discoverActiveSales).not.toHaveBeenCalled();
    expect(logRecords).toEqual([]);
  });

  test("fails closed without request or provider work and logs evaluation failures", async () => {
    const isEnabled = mock(() => Effect.fail(evaluationError()));
    installFeatureFlagDefault(isEnabled);

    await expect(
      Effect.runPromise(
        getActivePublicSales({ locale: "en-US" }).pipe(
          Effect.provide(Logger.layer([logger]))
        )
      )
    ).resolves.toEqual([]);

    expect(isEnabled).toHaveBeenCalledWith("calendar_sales");
    expect(connection).not.toHaveBeenCalled();
    expect(discoverActiveSales).not.toHaveBeenCalled();
    expect(logRecords).toContainEqual({
      level: "Warn",
      message: "Could not evaluate the PostHog feature flag.",
    });
  });
});

test("resolves active sales at request time outside the source cache", async () => {
  const source = await Bun.file(
    new URL("./active-public-sales.server.ts", import.meta.url)
  ).text();
  const connection = source.indexOf("await connection()");

  expect(connection).toBeGreaterThan(-1);
  expect(connection).toBeLessThan(source.indexOf("getCurrentWorkspaceDate()"));
  expect(source).not.toContain('"use cache"');
});
