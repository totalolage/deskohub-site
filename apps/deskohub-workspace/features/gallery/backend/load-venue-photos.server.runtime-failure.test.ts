import "@/shared/testing/workspace-test-env";

import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import { cloudinaryTags } from "@/shared/utils/cache-tags";

const runtimeStartFailure = new Error("synthetic tracing exporter unavailable");
const nextCache = recordNextCache();
const originalFetch = globalThis.fetch;
const fetchCalls = mock(async () => new Response("[]", { status: 200 }));

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// The real Workspace runner builds its observability layer before entering
// the gallery Effect, so this fails every run in this file before the lookup
// starts, as a production runtime that cannot start would.
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("@/shared/backend/observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () =>
    Layer.effectDiscard(Effect.fail(runtimeStartFailure)),
  WorkspaceTracingLive: Layer.effectDiscard(Effect.fail(runtimeStartFailure)),
}));
mock.module("cloudinary", () => ({
  v2: {
    config: mock(() => undefined),
    url: mock(
      (source: string) =>
        `https://res.cloudinary.test/test-cloud/image/list/${encodeURIComponent(source)}.json`
    ),
  },
}));
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

test("serves no images with the failure cache profile when the Workspace runtime cannot start", async () => {
  globalThis.fetch = Object.assign(fetchCalls, {
    preconnect: originalFetch.preconnect,
  });
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    const images = await loadVenuePhotos("gallery", "en-US");

    expect(images).toEqual([]);
    expect(fetchCalls).not.toHaveBeenCalled();
    expect(nextCache.calls).toEqual([
      { cacheLife: { stale: 30, revalidate: 60, expire: 300 } },
      {
        cacheTag: [
          cloudinaryTags.all(),
          cloudinaryTags.search(["gallery"], 80),
        ],
      },
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).toContain(
      "gallery.images.load_failed"
    );
  } finally {
    warn.mockRestore();
  }
});
