import "@/shared/testing/workspace-test-env";

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { m } from "@/features/i18n";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const providerMessage =
  "provider failure for cloudinary-account-id-sentinel " +
  "with api_secret=synthetic-cloudinary-secret-sentinel";

let tagListAttempts = 0;
let tagListStatus = 401;
let resources: object[] = [];
let requestedTags: string[] = [];
const nextCache = recordNextCache();

// The SDK only builds URLs here; signing is covered by the package tests.
const cloudinary = {
  config: mock(() => undefined),
  url: mock(
    (
      source: string,
      options: { type: string; version?: string; format?: string }
    ) =>
      options.type === "list"
        ? `https://res.cloudinary.test/test-cloud/image/list/s--fake-signature--/${encodeURIComponent(source)}.json`
        : `https://res.cloudinary.com/test-cloud/image/upload/v${options.version ?? "1"}/${source}.${options.format ?? "jpg"}`
  ),
};

const originalFetch = globalThis.fetch;
const rejectingFetch: typeof globalThis.fetch = Object.assign(
  async (input) => {
    requestedTags.push(String(input).split("/").at(-1)!.replace(".json", ""));
    tagListAttempts += 1;
    return new Response(
      tagListStatus === 200 ? JSON.stringify({ resources }) : providerMessage,
      { status: tagListStatus }
    );
  },
  { preconnect: originalFetch.preconnect }
);

const galleryLife = { stale: 300, revalidate: 300, expire: 86_400 };
const failureLife = { stale: 30, revalidate: 60, expire: 300 };
const galleryTags = {
  cacheTag: [cloudinaryTags.all(), cloudinaryTags.search(["gallery"], 80)],
};

beforeEach(() => {
  tagListAttempts = 0;
  tagListStatus = 401;
  resources = [];
  requestedTags = [];
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
const { loadVenuePhotos } = await import("./load-venue-photos.server");

describe("loadVenuePhotos provider failures", () => {
  test("degrades to no images and refreshes within a minute while staying prerenderable", async () => {
    const images = await loadVenuePhotos("gallery", "en-US");

    expect(images).toEqual([]);
    expect(tagListAttempts).toBe(1);
    expect(nextCache.calls).toEqual([{ cacheLife: failureLife }, galleryTags]);
  });
});

describe("loadVenuePhotos caching", () => {
  test("shares a tag list under the gallery lifetime and its search tags", async () => {
    // Cloudinary answers 404 for a tag that no asset carries.
    tagListStatus = 404;

    await expect(loadVenuePhotos("gallery", "en-US")).resolves.toEqual([]);
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
});

const resource = (
  custom: Record<string, string> = {},
  dimensions = { width: 1600, height: 1200 }
) => ({
  public_id: "venue-one",
  version: 123,
  format: "jpg",
  created_at: "2026-01-01T00:00:00Z",
  context: { custom },
  ...dimensions,
});

describe("loadVenuePhotos projection", () => {
  test("localizes trimmed alt, caption and detail, preserving identity and versioned lightbox sizing", async () => {
    tagListStatus = 200;
    resources = [
      resource({
        alt: "Default alt",
        "alt-cs-CZ": " Český popis ",
        caption: "Default caption",
        "caption-cs-CZ": " Český titulek ",
        detail: "Default detail",
        "detail-cs-CZ": " Český detail ",
      }),
    ];
    const [photo] = await loadVenuePhotos("meeting-room-gallery", "cs-CZ");
    expect(photo).toMatchObject({
      id: "venue-one",
      publicId: "venue-one",
      alt: "Český popis",
      caption: "Český titulek",
      detail: "Český detail",
      width: 1600,
      height: 1200,
      lightbox: {
        alt: "Český popis",
        title: "Český titulek",
        description: "Český detail",
        width: 1600,
        height: 1200,
      },
    });
    expect(photo?.src).toContain("w_960");
    expect(photo?.lightbox.src).toContain("w_1920");
    expect(photo?.lightbox.src).toContain("c_limit");
    expect(photo?.lightbox.src).toContain("/v123/venue-one");
    expect(photo).not.toHaveProperty("context");
    expect(photo).not.toHaveProperty("secure_url");
  });

  test("uses neutral context then caption then the album's localized fallback", async () => {
    tagListStatus = 200;
    resources = [
      resource({ alt: " Neutral alt ", "alt-cs-CZ": " ", caption: "Caption" }),
    ];
    expect((await loadVenuePhotos("gallery", "cs-CZ"))[0]?.alt).toBe(
      "Neutral alt"
    );
    resources = [resource({ alt: " ", "caption-cs-CZ": " Český titulek " })];
    const [captionPhoto] = await loadVenuePhotos("ttrpg-room-bar", "cs-CZ");
    expect(captionPhoto?.alt).toBe("Český titulek");
    expect(captionPhoto?.lightbox.description).toBe("Český titulek");
    resources = [resource({ alt: " ", caption: " ", "caption-cs-CZ": "" })];
    const [fallbackPhoto] = await loadVenuePhotos("ttrpg-room-bar", "cs-CZ");
    expect(fallbackPhoto?.alt).toBe(
      m.ttrpgRoomBarImageAlt({}, { locale: "cs-CZ" })
    );
    expect(fallbackPhoto?.caption).toBeUndefined();
  });

  test("filters unusable dimensions, including an entirely invalid album", async () => {
    tagListStatus = 200;
    resources = [
      { ...resource({}, { width: 0, height: 600 }), public_id: "zero-width" },
      { ...resource({}, { width: 800, height: 0 }), public_id: "zero-height" },
      {
        ...resource({}, { width: 800, height: -1 }),
        public_id: "negative-height",
      },
    ];
    expect(await loadVenuePhotos("gallery", "en-US")).toEqual([]);
    resources.push({ ...resource(), public_id: "valid-photo" });
    expect(
      (await loadVenuePhotos("gallery", "en-US")).map((photo) => photo.id)
    ).toEqual(["valid-photo"]);
  });

  test.each([
    ["gallery", ["gallery"], 80],
    ["landing-carousel", ["landing-carousel"], 20],
    ["coworking", ["landing-carousel"], 20],
    ["meeting-room-hero", ["meeting-room-hero"], 1],
    ["meeting-room-gallery", ["meeting-room-gallery"], 90],
    ["ttrpg-room-bar", ["ttrpg-room", "ttrpg-room-bar"], 90],
    ["ttrpg-room-workspace", ["ttrpg-room", "ttrpg-room-workspace"], 90],
  ] as const)("preserves %s's tags and limit", async (album, tags, limit) => {
    tagListStatus = 200;
    resources = Array.from({ length: 90 }, (_, index) => ({
      ...resource(),
      public_id: `photo-${String(89 - index).padStart(2, "0")}`,
    }));
    const photos = await loadVenuePhotos(album, "en-US");
    expect(photos).toHaveLength(limit);
    expect(requestedTags.sort()).toEqual([...tags].sort());
    if (album === "meeting-room-gallery")
      expect(photos[0]?.id).toBe("photo-00");
  });
});
