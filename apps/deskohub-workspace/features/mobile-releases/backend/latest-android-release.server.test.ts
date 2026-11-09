import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Option } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { githubMobileRelease } from "../android-release.test-utils";
import { fakeGitHubApi } from "./github-api.test-utils";

// Outside a Next.js render there is no cache; record what each load asks of
// it instead.
const nextCacheModule = await import("next/cache");
const nextCache = recordNextCache();
mock.module("next/cache", () => ({ ...nextCacheModule, ...nextCache.module }));

const { loadLatestAndroidRelease, MobileReleaseLookupError } = await import(
  "./latest-android-release.server"
);

const releaseLife = {
  cacheLife: { stale: 300, revalidate: 600, expire: 86_400 },
};
const failureLife = { cacheLife: { stale: 30, revalidate: 120, expire: 300 } };

// Effect reads the global `fetch` once, on the first request, so one stub
// stays installed and serves whichever fake GitHub API the test set up.
const originalFetch = globalThis.fetch;
let github = fakeGitHubApi({});
globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => github.fetch(input, init),
  { preconnect: originalFetch.preconnect }
);
const serveGitHub = (routes: Parameters<typeof fakeGitHubApi>[0]) => {
  github = fakeGitHubApi(routes);
  return github;
};

beforeEach(() => nextCache.clear());
afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("loadLatestAndroidRelease", () => {
  test("shares the latest release for ten minutes", async () => {
    serveGitHub({
      "/git/matching-refs/tags/mobile-v": () =>
        Response.json([{ ref: "refs/tags/mobile-v1.2.3" }]),
      "/releases/tags/mobile-v1.2.3": () =>
        Response.json(githubMobileRelease("1.2.3")),
    });

    const exit = await Effect.runPromiseExit(loadLatestAndroidRelease());

    expect(exit).toEqual(
      Exit.succeed(
        Option.some(expect.objectContaining({ versionName: "1.2.3" }))
      )
    );
    expect(nextCache.calls).toEqual([releaseLife]);
  });

  test("shares the absence of a release as long as a release", async () => {
    serveGitHub({
      "/git/matching-refs/tags/mobile-v": () => Response.json([]),
    });

    expect(await Effect.runPromiseExit(loadLatestAndroidRelease())).toEqual(
      Exit.succeed(Option.none())
    );
    expect(nextCache.calls).toEqual([releaseLife]);
  });

  test("shares a failed lookup briefly, as a failure rather than no release", async () => {
    const api = serveGitHub({
      "/git/matching-refs/tags/mobile-v": () =>
        new Response("unavailable", { status: 503 }),
    });

    const exit = await Effect.runPromiseExit(loadLatestAndroidRelease());

    expect(api.requests).toHaveLength(1);
    expect(Exit.findErrorOption(exit)).toEqual(
      Option.some(expect.any(MobileReleaseLookupError))
    );
    // Without a throw from the cached function, a prerendered page that
    // reads it still renders.
    expect(nextCache.calls).toEqual([failureLife]);
  });
});
