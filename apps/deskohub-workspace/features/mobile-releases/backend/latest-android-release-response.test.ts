import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { selectLatestAndroidRelease } from "../android-release";
import { githubMobileRelease } from "../android-release.test-utils";
import { MobileReleaseLookupError } from "./android-release-lookup";
import { AndroidReleases } from "./android-releases.service";
import { respondWithLatestAndroidRelease } from "./latest-android-release-response";

const release = Option.getOrThrow(
  selectLatestAndroidRelease([githubMobileRelease("1.2.3")])
);

const respondWith = (latest: AndroidReleases["Service"]["latest"]) =>
  respondWithLatestAndroidRelease.pipe(
    Effect.provide(Layer.succeed(AndroidReleases, { latest })),
    Effect.runPromise
  );

const sharedCaching = "public, s-maxage=600, stale-while-revalidate=3600";

describe("respondWithLatestAndroidRelease", () => {
  test("serves the latest release as JSON, cached at the edge", async () => {
    const response = await respondWith(Effect.succeedSome(release));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith(
      "application/json"
    );
    expect(response.headers.get("cache-control")).toBe(sharedCaching);
    expect(await response.json()).toEqual(release);
  });

  test("answers 404 without a release, cached the same way", async () => {
    const response = await respondWith(Effect.succeedNone);

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe(sharedCaching);
    expect(await response.json()).toEqual({ error: "no-release" });
  });

  test("answers 502 when GitHub can't be read, never cached", async () => {
    const response = await respondWith(
      Effect.fail(MobileReleaseLookupError.fromCause(new Error("rate limited")))
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "lookup-failed" });
  });
});
