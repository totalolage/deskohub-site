import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { OtaUpdateSource } from "./ota-update";
import {
  isUpdateCheckDue,
  planUpdateCheck,
  runUpdateCheck,
  updateCheckIntervalMs,
} from "./update-check";

describe("isUpdateCheckDue", () => {
  const startedAt = 1_000_000;

  test("checks when no check has started yet", () => {
    expect(isUpdateCheckDue(undefined, startedAt)).toBeTrue();
  });

  test("waits out the interval after a check started", () => {
    expect(isUpdateCheckDue(startedAt, startedAt)).toBeFalse();
    expect(
      isUpdateCheckDue(startedAt, startedAt + updateCheckIntervalMs - 1)
    ).toBeFalse();
  });

  test("checks again once the interval has passed", () => {
    expect(
      isUpdateCheckDue(startedAt, startedAt + updateCheckIntervalMs)
    ).toBeTrue();
  });

  test("checks again when the clock moved back behind the last check", () => {
    expect(isUpdateCheckDue(startedAt, startedAt - 1)).toBeTrue();
  });

  test("waits about fifteen minutes", () => {
    expect(updateCheckIntervalMs).toBe(15 * 60 * 1000);
  });
});

describe("planUpdateCheck", () => {
  test("checks both kinds of update on Android", () => {
    expect(
      planUpdateCheck({ platform: "android", otaUpdatesEnabled: true })
    ).toEqual({ otaUpdate: true, nativeRelease: true });
  });

  test("checks only over-the-air updates on iOS, where no APK applies", () => {
    expect(
      planUpdateCheck({ platform: "ios", otaUpdatesEnabled: true })
    ).toEqual({ otaUpdate: true, nativeRelease: false });
  });

  test("skips over-the-air updates when expo-updates is disabled", () => {
    expect(
      planUpdateCheck({ platform: "android", otaUpdatesEnabled: false })
    ).toEqual({ otaUpdate: false, nativeRelease: true });
  });

  test("checks nothing on web, which the Workspace serves fresh", () => {
    expect(
      planUpdateCheck({ platform: "web", otaUpdatesEnabled: true })
    ).toEqual({ otaUpdate: false, nativeRelease: false });
  });
});

describe("runUpdateCheck", () => {
  const recordingSources = () => {
    const calls: Array<string> = [];
    const updates: OtaUpdateSource = {
      checkForUpdateAsync: async () => {
        calls.push("ota-check");
        return {
          isAvailable: true,
          isRollBackToEmbedded: false,
          manifest: { id: "update-a" },
          reason: undefined,
        } as unknown as Awaited<
          ReturnType<OtaUpdateSource["checkForUpdateAsync"]>
        >;
      },
      fetchUpdateAsync: async () => {
        calls.push("ota-fetch");
        return {
          isNew: true,
          isRollBackToEmbedded: false,
          manifest: { id: "update-a" },
        } as unknown as Awaited<
          ReturnType<OtaUpdateSource["fetchUpdateAsync"]>
        >;
      },
    };
    const fetch = Object.assign(
      async () => {
        calls.push("release-lookup");
        return Response.json({ versionName: "1.3.0", versionCode: 1_003_000 });
      },
      { preconnect: globalThis.fetch.preconnect }
    );
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
    );
    return { calls, layer, updates };
  };

  const run = (platform: string) => {
    const { calls, layer, updates } = recordingSources();
    return Effect.runPromise(
      runUpdateCheck({
        plan: planUpdateCheck({ platform, otaUpdatesEnabled: true }),
        updates,
        installedBuildVersion: "1002000",
        latestReleaseUrl: "https://workspace.test/api/mobile/releases/latest",
      }).pipe(Effect.provide(layer))
    ).then((outcome) => ({ calls, outcome }));
  };

  test("reports both updates on Android", async () => {
    const { calls, outcome } = await run("android");
    expect(outcome).toEqual({
      readyUpdateId: "update-a",
      nativeUpdate: { versionName: "1.3.0", versionCode: 1_003_000 },
    });
    expect(calls.toSorted()).toEqual([
      "ota-check",
      "ota-fetch",
      "release-lookup",
    ]);
  });

  test("asks nothing of either source on web", async () => {
    const { calls, outcome } = await run("web");
    expect(outcome).toEqual({
      readyUpdateId: undefined,
      nativeUpdate: undefined,
    });
    expect(calls).toEqual([]);
  });
});
