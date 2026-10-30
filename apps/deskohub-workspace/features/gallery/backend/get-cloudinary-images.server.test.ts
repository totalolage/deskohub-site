import "@/shared/testing/workspace-test-env";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const providerMessage =
  "provider failure for cloudinary-account-id-sentinel " +
  "with api_secret=synthetic-cloudinary-secret-sentinel";

let tagListAttempts = 0;
let tagListStatus = 401;
const nextCache = recordNextCache();

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
    return new Response(providerMessage, { status: tagListStatus });
  },
  { preconnect: originalFetch.preconnect }
);

const galleryLife = { stale: 300, revalidate: 300, expire: 86_400 };
const failureLife = { stale: 30, revalidate: 60, expire: 300 };
const galleryTags = {
  cacheTag: [cloudinaryTags.all(), cloudinaryTags.search([["gallery"]], 50)],
};

beforeEach(() => {
  tagListAttempts = 0;
  tagListStatus = 401;
  nextCache.clear();
  globalThis.fetch = rejectingFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

mock.module("cloudinary", () => ({ v2: cloudinary }));
mock.module("next/cache", () => ({
  ...nextCache.module,
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
const { getCloudinaryImages } = await import("./get-cloudinary-images.server");

describe("getCloudinaryImages provider failures", () => {
  test("degrades to no images and refreshes within a minute while staying prerenderable", async () => {
    const images = await getCloudinaryImages({ tags: [["gallery"]] });

    expect(images).toEqual([]);
    expect(tagListAttempts).toBe(1);
    expect(nextCache.calls).toEqual([{ cacheLife: failureLife }, galleryTags]);
  });
});

describe("getCloudinaryImages caching", () => {
  test("shares a tag list under the gallery lifetime and its search tags", async () => {
    // Cloudinary answers 404 for a tag that no asset carries.
    tagListStatus = 404;

    await expect(getCloudinaryImages({ tags: [["gallery"]] })).resolves.toEqual(
      []
    );
    expect(nextCache.calls).toEqual([{ cacheLife: galleryLife }, galleryTags]);
  });

  test("bounds the cache life so a webhook refresh racing the CDN tag list heals", () => {
    // A tag change must surface within about six minutes: one minute of CDN
    // regeneration plus at most five minutes until the next revalidation.
    expect(galleryLife.revalidate).toBeLessThanOrEqual(5 * 60);
    expect(Number.isFinite(galleryLife.expire)).toBe(true);
    // The failure lifetime refreshes within a minute and keeps the 5-minute
    // expiry that holds a caller without Suspense in the static shell.
    expect(failureLife.revalidate).toBeLessThanOrEqual(60);
    expect(failureLife.expire).toBe(300);
  });

  test("selects nothing for exclusion-only expressions without a request", async () => {
    const images = await getCloudinaryImages({ tags: [["!gallery"]] });

    expect(images).toEqual([]);
    expect(tagListAttempts).toBe(0);
    expect(nextCache.calls).toEqual([{ cacheLife: galleryLife }]);
  });
});
