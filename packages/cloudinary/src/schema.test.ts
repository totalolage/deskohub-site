import { describe, expect, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import * as Schema from "effect/Schema";
import { CloudinaryAssetSchema } from "./schema";

const asset = (custom: Record<string, string>) => ({
  public_id: "gallery/desk",
  secure_url: "https://res.cloudinary.test/desk.jpg",
  url: "http://res.cloudinary.test/desk.jpg",
  width: 1600,
  height: 1200,
  format: "jpg",
  resource_type: "image",
  created_at: "2026-01-01T00:00:00Z",
  context: { custom },
});

describe("CloudinaryAssetSchema context", () => {
  test("keeps the bare and every supported locale's alt, caption and detail", () => {
    const custom = Object.fromEntries(
      ["alt", "caption", "detail"].flatMap((field) => [
        [field, `${field} bare`],
        ...supportedLocales.map((locale) => [
          `${field}-${locale}`,
          `${field} ${locale}`,
        ]),
      ])
    );

    const decoded = Schema.decodeUnknownSync(CloudinaryAssetSchema)(
      asset({ ...custom, "alt-xx-XX": "unsupported", title: "other" })
    );

    expect(decoded.context?.custom).toEqual(custom);
  });
});
