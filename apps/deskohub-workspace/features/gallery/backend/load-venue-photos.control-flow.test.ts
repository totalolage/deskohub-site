import "@/shared/testing/workspace-test-env";

import { beforeEach, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { notFound, redirect } from "next/navigation";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

const external = await import("@deskohub/cloudinary/server");
let load = Effect.interrupt;
const nextCache = recordNextCache();
mock.module("@deskohub/cloudinary/server", () => ({
  ...external,
  getGalleryImages: () => load,
}));
mock.module("next/cache", () => nextCache.module);
mock.module("@/env", () => ({
  env: {
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "test-cloud",
    CLOUDINARY_API_KEY: "test-key",
    CLOUDINARY_API_SECRET: "test-secret",
  },
}));
const { loadVenuePhotos } = await import("./load-venue-photos.server");
beforeEach(() => nextCache.clear());

test("propagates interruption and expires the entry instead of sharing an empty album", async () => {
  load = Effect.interrupt;
  await expect(loadVenuePhotos("gallery", "en-US")).rejects.toThrow(
    "interrupt"
  );
  expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
});

test.each([
  ["notFound", () => notFound(), "NEXT_HTTP_ERROR_FALLBACK;404"],
  ["redirect", () => redirect("/target"), "NEXT_REDIRECT"],
] as const)(
  "propagates Next %s without sharing a fallback",
  async (_name, control, digest) => {
    load = Effect.sync(control);
    await expect(loadVenuePhotos("gallery", "en-US")).rejects.toMatchObject({
      digest: expect.stringContaining(digest),
    });
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  }
);
