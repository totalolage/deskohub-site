import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { CloudinarySearchError } from "@deskohub/cloudinary";
import type { ICloudinaryService } from "@deskohub/cloudinary/server";
import { Effect, Layer, Logger, References } from "effect";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

const listTaggedAssets = mock<ICloudinaryService["listTaggedAssets"]>(() =>
  Effect.succeed([])
);

let getCloudinaryImagesEffect: typeof import("./get-cloudinary-images.server").getCloudinaryImagesEffect;

beforeAll(async () => {
  const { CloudinaryService } = await import("@deskohub/cloudinary/server");

  mock.module("@/features/gallery/backend/cloudinary.service", () => ({
    GalleryCloudinaryLayer: Layer.mock(CloudinaryService, { listTaggedAssets }),
  }));

  ({ getCloudinaryImagesEffect } = await import(
    "./get-cloudinary-images.server"
  ));
});

beforeEach(() => {
  listTaggedAssets.mockClear();
  listTaggedAssets.mockImplementation(() => Effect.succeed([]));
});

test("keeps normalized gallery tags and result limits", async () => {
  const tags = [["Web galerie", "galerie"]] as const;

  const assets = await Effect.runPromise(getCloudinaryImagesEffect(tags, 7));

  expect(assets).toEqual([]);
  expect(listTaggedAssets).toHaveBeenCalledWith(tags, { maxResults: 7 });
});

test("returns an empty gallery without logging provider error data", async () => {
  const sentinels = [
    "cloudinary-provider-message-sentinel",
    "cloudinary-expression-sentinel",
    "cloudinary-public-id-sentinel",
    "https://cloudinary-url-sentinel.example.test/image.jpg",
    "galerie",
  ];
  const error = new CloudinarySearchError({
    message: sentinels[0]!,
    expression: `${sentinels[1]} ${sentinels[2]} ${sentinels[3]}`,
  });
  listTaggedAssets.mockImplementation(() => Effect.fail(error));

  const logRecords: {
    readonly annotations: Record<string, unknown>;
    readonly level: string;
    readonly message: unknown;
  }[] = [];
  const logger = Logger.make((options) => {
    logRecords.push({
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      level: options.logLevel,
      message: options.message,
    });
  });

  const assets = await Effect.runPromise(
    getCloudinaryImagesEffect([["galerie"]], 50).pipe(
      Effect.provide(Logger.layer([logger]))
    )
  );

  expect(assets).toEqual([]);
  const capturedLogs = JSON.stringify(logRecords);
  expect(capturedLogs).toContain(
    "Boardgame gallery Cloudinary image lookup failed"
  );
  for (const sentinel of sentinels) {
    expect(capturedLogs).not.toContain(sentinel);
  }
});
