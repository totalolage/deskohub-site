import { mock, spyOn } from "bun:test";
import {
  type CloudinaryAsset,
  CloudinarySearchError,
} from "@deskohub/cloudinary";
import { Effect, Layer } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

export const cloudinaryAsset = (publicId: string) =>
  ({
    public_id: publicId,
    secure_url: `https://res.cloudinary.com/cloud/image/upload/${publicId}.jpg`,
    width: 1600,
    height: 900,
    format: "jpg",
    resource_type: "image",
    created_at: "2026-01-01T00:00:00Z",
  }) as CloudinaryAsset;

/** The blur placeholder the fake low-res fetch produces. */
export const blurDataURL = "data:image/webp;base64,AQID";

/**
 * Fakes Cloudinary for the Palmovcon page: only `available` public IDs exist,
 * and blur placeholders fail to load for `blurFailures`. Call before importing
 * the modules under test.
 */
export const installPalmovconImageFakes = async () => {
  const fakes = {
    available: new Set<string>(),
    blurFailures: new Set<string>(),
  };

  setBoardgameTestEnv();
  mock.module("server-only", () => ({}));
  const nextCache = await import("next/cache");
  mock.module("next/cache", () => ({ ...nextCache, cacheTag: () => {} }));
  const nextServer = await import("next/server");
  mock.module("next/server", () => ({
    ...nextServer,
    connection: async () => {},
  }));

  const { CloudinaryService } = await import("@deskohub/cloudinary/server");
  mock.module("@/features/gallery/backend/cloudinary.service", () => ({
    GalleryCloudinaryLayer: Layer.mock(CloudinaryService, {
      getByPublicId: (publicId) =>
        fakes.available.has(publicId)
          ? Effect.succeed(cloudinaryAsset(publicId))
          : Effect.fail(
              new CloudinarySearchError({
                message: "not found",
                expression: publicId,
              })
            ),
    }),
  }));

  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request
  ) => {
    const { pathname } = new URL(String(input));
    const fails = [...fakes.blurFailures].some((publicId) =>
      pathname.endsWith(`/${publicId}`)
    );
    return fails
      ? new Response(null, { status: 500 })
      : new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/webp" },
        });
  }) as typeof fetch);

  return { fakes, restoreFetch: () => fetchSpy.mockRestore() };
};
