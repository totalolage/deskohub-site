import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { readExportedUpdates, toUpdatePublication } from "./exported-update";

const fixtureExport = fileURLToPath(
  new URL("./fixtures/export", import.meta.url)
);

// Digests of the fixture files, computed with sha256sum, openssl and md5sum.
const androidBundle = {
  sha256: "9295f55b921438c98c566a78ab327261ff5e17328b855d8e8b8e13ce1027429f",
  hash: "kpX1W5IUOMmMVmp4qzJyYf9eFzKLhV2Oi44TzhAnQp8",
  key: "e59f0aed71fca45de3d061c0ecb365eb",
};
const iosBundle = {
  sha256: "4656317d10d1666af4992666d3b0fd03b4c24bb71eba8ef09510bd225f01a05e",
  hash: "RlYxfRDRZmr0mSZm07D9A7TCS7ceuo7wlRC9Il8BoF4",
  key: "d97195993bec6376bf7c767ae748d0ed",
};
const image = {
  sha256: "c06303dd848a80e9e774747ca5f185ba68129bb55e4842c72ed477340fc8100c",
  hash: "wGMD3YSKgOnndHR8pfGFumgSm7VeSELHLtR3NA_IEAw",
  key: "d745e4d777b842fdec622dab9ebc8fdc",
};

const stored = (pathname: string) => `https://blob.test/${pathname}`;

const release = (pathnames: readonly string[]) => ({
  id: "6f2b2a43-3d1c-4f53-9a51-7f0f7c9c1d10",
  runtimeVersion: "synthetic-runtime",
  expoClient: { name: "Synthetic", slug: "synthetic" },
  assetUrls: new Map(pathnames.map((pathname) => [pathname, stored(pathname)])),
});

const allPathnames = (
  updates: Effect.Success<ReturnType<typeof readExportedUpdates>>
) =>
  updates.flatMap(({ launchAsset, assets }) =>
    [launchAsset, ...assets].map(({ pathname }) => pathname)
  );

describe("exported mobile updates", () => {
  test("turn each platform's export into a publication of content-addressed files", async () => {
    const updates = await Effect.runPromise(
      readExportedUpdates(fixtureExport, ["android", "ios"])
    );
    const [android, ios] = updates.map((update) =>
      toUpdatePublication(update, release(allPathnames(updates)))
    );

    expect(android).toEqual({
      type: "update",
      id: "6f2b2a43-3d1c-4f53-9a51-7f0f7c9c1d10",
      platform: "android",
      runtimeVersion: "synthetic-runtime",
      launchAsset: {
        hash: androidBundle.hash,
        key: androidBundle.key,
        contentType: "application/javascript",
        url: `https://blob.test/mobile-updates/assets/${androidBundle.sha256}.hbc`,
      },
      assets: [
        {
          hash: image.hash,
          key: image.key,
          contentType: "image/png",
          fileExtension: ".png",
          url: `https://blob.test/mobile-updates/assets/${image.sha256}.png`,
        },
      ],
      metadata: {},
      extra: { expoClient: { name: "Synthetic", slug: "synthetic" } },
    });
    expect(ios).toMatchObject({
      platform: "ios",
      launchAsset: {
        hash: iosBundle.hash,
        key: iosBundle.key,
        url: `https://blob.test/mobile-updates/assets/${iosBundle.sha256}.hbc`,
      },
      assets: [{ hash: image.hash, key: image.key }],
    });
  });

  test("give a file both platforms share one stored pathname", async () => {
    const updates = await Effect.runPromise(
      readExportedUpdates(fixtureExport, ["android", "ios"])
    );

    expect(new Set(allPathnames(updates))).toEqual(
      new Set([
        `mobile-updates/assets/${androidBundle.sha256}.hbc`,
        `mobile-updates/assets/${iosBundle.sha256}.hbc`,
        `mobile-updates/assets/${image.sha256}.png`,
      ])
    );
  });

  test("fail when the export lacks a requested platform", async () => {
    const exportDirectory = mkdtempSync(join(tmpdir(), "mobile-export-"));
    try {
      writeFileSync(
        join(exportDirectory, "metadata.json"),
        JSON.stringify({ version: 0, bundler: "metro", fileMetadata: {} })
      );
      const failure = await Effect.runPromise(
        Effect.flip(readExportedUpdates(exportDirectory, ["android"]))
      );

      expect(failure._tag).toBe("ExportedUpdateUnreadable");
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  });

  test("fail when a file the metadata lists is missing", async () => {
    const exportDirectory = mkdtempSync(join(tmpdir(), "mobile-export-"));
    try {
      cpSync(fixtureExport, exportDirectory, { recursive: true });
      rmSync(join(exportDirectory, "assets"), { recursive: true });
      const failure = await Effect.runPromise(
        Effect.flip(readExportedUpdates(exportDirectory, ["ios"]))
      );

      expect(failure._tag).toBe("ExportedUpdateUnreadable");
    } finally {
      rmSync(exportDirectory, { recursive: true, force: true });
    }
  });

  test("fail when a publication would point at a file that was never stored", async () => {
    const updates = await Effect.runPromise(
      readExportedUpdates(fixtureExport, ["android"])
    );
    const [android] = updates;
    if (android === undefined) throw new Error("No android update");

    expect(() => toUpdatePublication(android, release([]))).toThrow();
  });
});
