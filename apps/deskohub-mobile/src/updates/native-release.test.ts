import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  checkNativeRelease,
  nativeUpdateOffer,
  nextNativeUpdate,
} from "./native-release";

const latestReleaseUrl = "https://workspace.test/api/mobile/releases/latest";

const release = {
  versionName: "1.3.0",
  versionCode: 1_003_000,
  apkUrl:
    "https://github.com/totalolage/deskohub-site/releases/download/mobile-v1.3.0/deskohub-1.3.0.apk",
  apkSizeBytes: 52_000_000,
  apkSha256: "a".repeat(64),
  certificateSha256: "b".repeat(64),
  publishedAt: "2026-11-07T10:00:00Z",
  releaseUrl:
    "https://github.com/totalolage/deskohub-site/releases/tag/mobile-v1.3.0",
};

describe("nativeUpdateOffer", () => {
  test("offers a release with a larger version code", () => {
    expect(nativeUpdateOffer("1002000", release)).toEqual({
      versionName: "1.3.0",
      versionCode: 1_003_000,
    });
  });

  test("offers nothing for the installed version or an older one", () => {
    expect(nativeUpdateOffer("1003000", release)).toBeUndefined();
    expect(nativeUpdateOffer("1004000", release)).toBeUndefined();
  });

  test.each([null, "", "abc", "1.2", "-1"])(
    "offers nothing when the installed version code %p is unreadable",
    (installed) => {
      expect(nativeUpdateOffer(installed, release)).toBeUndefined();
    }
  );
});

const respondWith = (handler: (url: string) => Promise<Response>) => {
  const requested: Array<string> = [];
  const fetch = Object.assign(
    (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requested.push(url);
      return handler(url);
    },
    { preconnect: globalThis.fetch.preconnect }
  );
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  return { layer, requested };
};

const lookup = (
  installedBuildVersion: string | null,
  handler: (url: string) => Promise<Response>
) => {
  const { layer, requested } = respondWith(handler);
  return Effect.runPromise(
    checkNativeRelease({ installedBuildVersion, latestReleaseUrl }).pipe(
      Effect.provide(layer)
    )
  ).then((check) => ({ check, requested }));
};

const offer = { versionName: "1.3.0", versionCode: 1_003_000 };

describe("checkNativeRelease", () => {
  test("offers the latest release when it is newer than the installed build", async () => {
    const { check, requested } = await lookup("1002000", async () =>
      Response.json(release)
    );
    expect(check).toEqual({ kind: "newer", offer });
    expect(requested).toEqual([latestReleaseUrl]);
  });

  test("reports the installed build current when it is the latest", async () => {
    const { check } = await lookup("1003000", async () =>
      Response.json(release)
    );
    expect(check).toEqual({ kind: "current" });
  });

  test("reports the installed build current when nothing is released yet", async () => {
    const { check } = await lookup("1002000", async () =>
      Response.json({ error: "no-release" }, { status: 404 })
    );
    expect(check).toEqual({ kind: "current" });
  });

  test("needs only the version fields of the release", async () => {
    const { check } = await lookup("1002000", async () => Response.json(offer));
    expect(check).toEqual({ kind: "newer", offer });
  });

  test("skips the request when the installed version code is unreadable", async () => {
    const { check, requested } = await lookup(null, async () =>
      Response.json(release)
    );
    expect(check).toEqual({ kind: "unknown" });
    expect(requested).toEqual([]);
  });

  test.each([
    [
      "a failed lookup",
      () => Response.json({ error: "lookup-failed" }, { status: 502 }),
    ],
    ["a body that is not JSON", () => new Response("<html>")],
    [
      "a release without a version code",
      () => Response.json({ versionName: "1.3.0" }),
    ],
    [
      "a fractional version code",
      () => Response.json({ ...release, versionCode: 1_003_000.5 }),
    ],
  ])("knows nothing after %s", async (_case, respond) => {
    const { check } = await lookup("1002000", async () => respond());
    expect(check).toEqual({ kind: "unknown" });
  });

  test("knows nothing when the network fails", async () => {
    const { check } = await lookup("1002000", () =>
      Promise.reject(new TypeError("Network request failed"))
    );
    expect(check).toEqual({ kind: "unknown" });
  });
});

describe("nextNativeUpdate", () => {
  const earlier = { versionName: "1.2.5", versionCode: 1_002_005 };

  test("replaces the offer with a newer release", () => {
    expect(nextNativeUpdate(earlier, { kind: "newer", offer })).toEqual(offer);
    expect(nextNativeUpdate(undefined, { kind: "newer", offer })).toEqual(
      offer
    );
  });

  test("withdraws the offer when nothing newer is published", () => {
    expect(nextNativeUpdate(offer, { kind: "current" })).toBeUndefined();
  });

  test("keeps the offer when the lookup failed", () => {
    expect(nextNativeUpdate(offer, { kind: "unknown" })).toEqual(offer);
    expect(nextNativeUpdate(undefined, { kind: "unknown" })).toBeUndefined();
  });
});
