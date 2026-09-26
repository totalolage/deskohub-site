import { describe, expect, test } from "bun:test";
import * as Schema from "effect/Schema";
import { buildVersionedDeliveryUrl } from "./delivery";
import { CloudinaryAssetSchema } from "./schema";

const makeAsset = (overrides: Record<string, unknown>) =>
  Schema.decodeUnknownSync(CloudinaryAssetSchema)({
    public_id: "avatars/live/account-1",
    secure_url:
      "https://res.cloudinary.com/demo/image/upload/avatars/live/account-1.webp",
    url: "http://res.cloudinary.com/demo/image/upload/avatars/live/account-1.webp",
    width: 512,
    height: 512,
    format: "webp",
    resource_type: "image",
    created_at: "2026-09-20T10:00:00Z",
    ...overrides,
  });

describe("buildVersionedDeliveryUrl", () => {
  test("inserts the version segment after the upload marker", () => {
    const asset = makeAsset({ version: 1710000000 });

    expect(buildVersionedDeliveryUrl(asset)).toBe(
      "https://res.cloudinary.com/demo/image/upload/v1710000000/avatars/live/account-1.webp"
    );
  });

  test("returns the plain secure URL when the asset has no version", () => {
    const asset = makeAsset({});

    expect(buildVersionedDeliveryUrl(asset)).toBe(asset.secure_url);
  });

  test("keeps an already-versioned URL unchanged", () => {
    const asset = makeAsset({
      secure_url:
        "https://res.cloudinary.com/demo/image/upload/v1710000000/avatars/live/account-1.webp",
      version: 1710000000,
    });

    expect(buildVersionedDeliveryUrl(asset)).toBe(asset.secure_url);
  });
});
