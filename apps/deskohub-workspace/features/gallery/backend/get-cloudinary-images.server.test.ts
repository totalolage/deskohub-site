import "@/shared/testing/workspace-test-env";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Predicate } from "effect";

const providerMessage =
  "provider failure for cloudinary-account-id-sentinel " +
  "with api_secret=synthetic-cloudinary-secret-sentinel";

let tagListAttempts = 0;
const cacheLife = mock(
  (_profile: string | { stale: number; revalidate: number; expire: number }) =>
    undefined
);

// The SDK only builds URLs here; signing is covered by the package tests.
const cloudinary = {
  config: mock(() => undefined),
  url: mock(
    (source: string) =>
      `https://res.cloudinary.test/test-cloud/image/list/s--fake--/${encodeURIComponent(source)}.json`
  ),
};

const originalFetch = globalThis.fetch;
const rejectingFetch: typeof globalThis.fetch = Object.assign(
  async () => {
    tagListAttempts += 1;
    return new Response(providerMessage, { status: 401 });
  },
  { preconnect: originalFetch.preconnect }
);

const cacheProfiles = () =>
  cacheLife.mock.calls.flatMap(([profile]) =>
    Predicate.isString(profile) ? [] : [profile]
  );

beforeEach(() => {
  tagListAttempts = 0;
  cacheLife.mockClear();
  globalThis.fetch = rejectingFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

mock.module("cloudinary", () => ({ v2: cloudinary }));
mock.module("next/cache", () => ({
  cacheLife,
  cacheTag: () => undefined,
  revalidateTag: () => undefined,
}));
mock.module("@/env", () => ({
  env: {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "test-secret",
  },
}));
// The real runner's only addition on top of a plain rejection is log
// annotation, so the propagated escaping error stays identical. The extra
// exports keep bun's cross-file module registry satisfied. The fallback
// runner's own runtime-failure handling is covered beside it in `shared` and
// by `get-cloudinary-images.server.runtime-failure.test.ts`.
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
  runWorkspaceEffectOrElse:
    <B>(
      _operation: string,
      { orElse }: { readonly orElse: (cause: unknown) => B }
    ) =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A | B> =>
      Effect.runPromise(effect).catch(orElse),
  defineWorkspaceTask: () => () => Promise.reject(new Error("unused")),
  scheduleWorkspaceTelemetryFlush: () => Effect.void,
}));

const { getCloudinaryImages } = await import("./get-cloudinary-images.server");

describe("getCloudinaryImages provider failures", () => {
  test("degrades to no images and refreshes within a minute while staying prerenderable", async () => {
    const images = await getCloudinaryImages({ tags: [["gallery"]] });

    expect(images).toEqual([]);
    expect(tagListAttempts).toBe(1);
    // The gallery profile applies first; the failure profile overrides it.
    const [galleryProfile, failureProfile] = cacheProfiles();
    expect(failureProfile?.revalidate).toBeLessThanOrEqual(60);
    expect(failureProfile?.revalidate).toBeLessThan(
      galleryProfile?.revalidate ?? 0
    );
  });
});

describe("getCloudinaryImages caching", () => {
  test("bounds the cache life so a webhook refresh racing the CDN tag list heals", async () => {
    await getCloudinaryImages({ tags: [["gallery"]] }).catch(() => undefined);

    const [galleryProfile] = cacheProfiles();
    // A tag change must surface within about six minutes: one minute of CDN
    // regeneration plus at most five minutes until the next revalidation.
    expect(galleryProfile?.revalidate).toBeLessThanOrEqual(5 * 60);
    expect(Number.isFinite(galleryProfile?.expire)).toBe(true);
    expect(cacheLife).not.toHaveBeenCalledWith("max");
  });

  test("selects nothing for exclusion-only expressions without a request", async () => {
    const images = await getCloudinaryImages({ tags: [["!gallery"]] });

    expect(images).toEqual([]);
    expect(tagListAttempts).toBe(0);
  });
});
