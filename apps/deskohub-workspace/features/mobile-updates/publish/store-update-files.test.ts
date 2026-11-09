import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { UpdateFile } from "./exported-update";
import { storeUpdateFiles } from "./store-update-files";
import { memoryUpdateAssetStorage } from "./update-asset-storage.service.mock";

const file = (name: string): UpdateFile => ({
  pathname: `mobile-updates/assets/${name}`,
  bytes: new TextEncoder().encode(name),
  asset: { hash: `${name}-hash`, key: `${name}-key`, contentType: "image/png" },
});

const bundle = file("bundle.hbc");
const image = file("image.png");
const font = file("font.ttf");

describe("storing update files", () => {
  test("uploads only files the store lacks and gives every file its URL", async () => {
    const storage = memoryUpdateAssetStorage({
      stored: [image.pathname],
    });

    const result = await Effect.runPromise(
      storeUpdateFiles([bundle, image, font, image]).pipe(
        Effect.provide(storage.layer)
      )
    );

    expect(storage.uploads).toEqual(
      expect.arrayContaining([bundle.pathname, font.pathname])
    );
    expect(storage.uploads).toHaveLength(2);
    expect(storage.uploadedContentTypes.get(font.pathname)).toBe("image/png");
    expect(result).toEqual({
      assetUrls: new Map([
        [bundle.pathname, storage.urlOf(bundle.pathname)],
        [image.pathname, storage.urlOf(image.pathname)],
        [font.pathname, storage.urlOf(font.pathname)],
      ]),
      uploaded: 2,
      reused: 1,
    });
  });

  test("reuses a file another publish stored while this one uploaded it", async () => {
    const storage = memoryUpdateAssetStorage({
      storedDuringUpload: [bundle.pathname],
    });

    const result = await Effect.runPromise(
      storeUpdateFiles([bundle]).pipe(Effect.provide(storage.layer))
    );

    expect(result).toEqual({
      assetUrls: new Map([[bundle.pathname, storage.urlOf(bundle.pathname)]]),
      uploaded: 0,
      reused: 1,
    });
  });

  test("fails when a file can't be uploaded", async () => {
    const storage = memoryUpdateAssetStorage({
      failedUploads: [font.pathname],
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        storeUpdateFiles([bundle, font]).pipe(Effect.provide(storage.layer))
      )
    );

    expect(failure._tag).toBe("UpdateAssetStorageUnavailable");
  });
});
