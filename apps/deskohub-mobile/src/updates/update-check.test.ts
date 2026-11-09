import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer } from "effect";
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
  const checkResult = {
    isAvailable: true,
    isRollBackToEmbedded: false,
    manifest: { id: "update-a" },
    reason: undefined,
  } as unknown as Awaited<ReturnType<OtaUpdateSource["checkForUpdateAsync"]>>;
  const fetchResult = {
    isNew: true,
    isRollBackToEmbedded: false,
    manifest: { id: "update-a" },
  } as unknown as Awaited<ReturnType<OtaUpdateSource["fetchUpdateAsync"]>>;

  const rollBackCheckResult = {
    isAvailable: false,
    isRollBackToEmbedded: true,
    manifest: undefined,
    reason: undefined,
  } as unknown as typeof checkResult;
  const rollBackFetchResult = {
    isNew: false,
    isRollBackToEmbedded: true,
    manifest: undefined,
  } as unknown as typeof fetchResult;

  const recordingSources = ({
    answer = async () => checkResult,
    download = async () => fetchResult,
  }: {
    readonly answer?: () => Promise<typeof checkResult>;
    readonly download?: () => Promise<typeof fetchResult>;
  } = {}) => {
    const calls: Array<string> = [];
    const updates: OtaUpdateSource = {
      checkForUpdateAsync: () => {
        calls.push("ota-check");
        return answer();
      },
      fetchUpdateAsync: () => {
        calls.push("ota-fetch");
        return download();
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

  const check = (
    platform: string,
    sources: ReturnType<typeof recordingSources>,
    reports: Array<unknown>
  ) =>
    runUpdateCheck({
      plan: planUpdateCheck({ platform, otaUpdatesEnabled: true }),
      updates: sources.updates,
      installedBuildVersion: "1002000",
      latestReleaseUrl: "https://workspace.test/api/mobile/releases/latest",
      onReadyUpdate: (update) => reports.push({ readyUpdate: update }),
      onNativeRelease: (release) => reports.push({ nativeRelease: release }),
    }).pipe(Effect.provide(sources.layer));

  test("reports both updates on Android", async () => {
    const sources = recordingSources();
    const reports: Array<unknown> = [];
    await Effect.runPromise(check("android", sources, reports));
    expect(reports).toContainEqual({
      readyUpdate: { kind: "update", updateId: "update-a" },
    });
    expect(reports).toContainEqual({
      nativeRelease: {
        kind: "newer",
        offer: { versionName: "1.3.0", versionCode: 1_003_000 },
      },
    });
    expect(sources.calls.toSorted()).toEqual([
      "ota-check",
      "ota-fetch",
      "release-lookup",
    ]);
  });

  test("reports the embedded update ready after a rollback directive", async () => {
    const sources = recordingSources({
      answer: async () => rollBackCheckResult,
      download: async () => rollBackFetchResult,
    });
    const reports: Array<unknown> = [];
    await Effect.runPromise(check("ios", sources, reports));
    expect(reports).toEqual([{ readyUpdate: { kind: "embedded" } }]);
    expect(sources.calls).toEqual(["ota-check", "ota-fetch"]);
  });

  test("reports the native release while an update is still downloading", async () => {
    const sources = recordingSources({
      download: () => new Promise(() => undefined),
    });
    const reports: Array<unknown> = [];
    const fiber = Effect.runFork(check("android", sources, reports));
    await Effect.runPromise(
      Effect.sleep("1 millis").pipe(
        Effect.repeat({ until: () => reports.length > 0 }),
        Effect.timeout("2 seconds")
      )
    );
    expect(reports).toEqual([
      {
        nativeRelease: {
          kind: "newer",
          offer: { versionName: "1.3.0", versionCode: 1_003_000 },
        },
      },
    ]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("asks nothing of either source on web", async () => {
    const sources = recordingSources();
    const reports: Array<unknown> = [];
    await Effect.runPromise(check("web", sources, reports));
    expect(reports).toEqual([]);
    expect(sources.calls).toEqual([]);
  });
});
