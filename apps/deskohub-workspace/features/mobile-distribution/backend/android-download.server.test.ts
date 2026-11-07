import "@/shared/testing/workspace-test-env";

import { afterAll, expect, mock, test } from "bun:test";
import { Effect, Logger, Option } from "effect";
import type {
  AndroidRelease,
  MobileReleaseLookupError,
} from "../android-download-release";

// A copy taken before the mock below replaces the module's exports.
const releaseModule = { ...(await import("../android-download-release")) };

const release = {
  versionName: "1.2.3",
  versionCode: 10_203,
  apkUrl:
    "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.2.3/deskohub-1.2.3.apk",
  apkSizeBytes: 42_123_456,
  apkSha256: "ab".repeat(32),
  certificateSha256: "00",
  publishedAt: "2026-11-05T09:30:00Z",
  releaseUrl:
    "https://github.com/totalolage/deskohub-site/releases/tag/mobile-v1.2.3",
} satisfies AndroidRelease;

let lookup: Effect.Effect<
  Option.Option<AndroidRelease>,
  MobileReleaseLookupError
> = Effect.succeed(Option.none());

mock.module("../android-download-release", () => ({
  ...releaseModule,
  loadLatestAndroidRelease: () => lookup,
}));

const { loadAndroidDownload } = await import("./android-download.server");

// Bun keeps module mocks for the rest of the run, so later files see no release.
afterAll(() => {
  lookup = Effect.succeed(Option.none());
});

test("offers the latest release", async () => {
  lookup = Effect.succeed(Option.some(release));

  expect(await Effect.runPromise(loadAndroidDownload)).toEqual({
    kind: "release",
    release,
  });
});

test("has nothing to offer before the first release", async () => {
  lookup = Effect.succeed(Option.none());

  expect(await Effect.runPromise(loadAndroidDownload)).toEqual({
    kind: "none",
  });
});

test("turns a failed lookup into the fallback state", async () => {
  lookup = Effect.fail(
    new releaseModule.MobileReleaseLookupError({
      cause: new Error("GitHub unavailable"),
    })
  );

  const download = loadAndroidDownload.pipe(Effect.provide(Logger.layer([])));

  expect(await Effect.runPromise(download)).toEqual({ kind: "unavailable" });
});
