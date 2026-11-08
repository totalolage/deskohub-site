import "@/shared/testing/workspace-test-env";

import { afterAll, expect, mock, spyOn, test } from "bun:test";
import { Effect, Exit, Logger, Option } from "effect";
import { redirect } from "next/navigation";
import type {
  AndroidRelease,
  MobileReleaseLookupError,
} from "@/features/mobile-releases/backend/latest-android-release.server";
import { SharedSnapshotLoadFailure } from "@/shared/backend/shared-snapshot";
import { findNextControlFlow } from "@/shared/backend/workspace-effect";

// A copy taken before the mock below replaces the module's exports.
const releaseModule = {
  ...(await import(
    "@/features/mobile-releases/backend/latest-android-release.server"
  )),
};

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

mock.module(
  "@/features/mobile-releases/backend/latest-android-release.server",
  () => ({
    ...releaseModule,
    loadLatestAndroidRelease: () => lookup,
  })
);

const { loadAndroidDownload } = await import("./android-download.server");

// Bun keeps module mocks for the rest of the run, so later files get the real
// module back.
afterAll(() => {
  mock.module(
    "@/features/mobile-releases/backend/latest-android-release.server",
    () => releaseModule
  );
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

// The page runs this outside any cache scope, where a prerender fails on a
// read of the current time, and Effect stamps every log line with
// `Date.now()`. The shared lookup logs its failure inside its cache scope.
test("turns a failed lookup into the fallback state without reading the current time", async () => {
  lookup = Effect.fail(
    new releaseModule.MobileReleaseLookupError({
      cause: new Error("GitHub unavailable"),
    })
  );
  const logged: unknown[] = [];
  const download = loadAndroidDownload.pipe(
    Effect.provide(
      Logger.layer([Logger.make(({ message }) => logged.push(message))])
    )
  );
  const now = spyOn(Date, "now").mockImplementation(() => {
    throw new Error("The current time was read during a prerender.");
  });

  try {
    expect(await Effect.runPromise(download)).toEqual({ kind: "unavailable" });
    expect(now).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
  expect(logged).toEqual([]);
});

// The shared lookup wraps whatever its cached loader rejects with, Next.js
// control flow such as a prerender bailout included, and that must reach
// Next.js instead of becoming the fallback state.
test("lets Next.js control flow from the lookup through", async () => {
  const controlFlow = (() => {
    try {
      redirect("/target");
    } catch (thrown) {
      return thrown;
    }
  })();
  lookup = Effect.fail(
    new releaseModule.MobileReleaseLookupError({
      cause: new SharedSnapshotLoadFailure({
        service: "mobile-releases",
        operation: "loadLatestAndroidRelease",
        cause: controlFlow,
      }),
    })
  );

  const exit = await Effect.runPromiseExit(loadAndroidDownload);

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(findNextControlFlow(exit.cause)).toBeDefined();
  }
});
