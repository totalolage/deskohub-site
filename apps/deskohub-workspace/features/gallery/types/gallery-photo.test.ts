import { describe, expect, test } from "bun:test";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { toGalleryPhotos } from "./gallery-photo";

const asset = {
  context: {
    custom: {
      alt: "Default alt",
      "alt-cs-CZ": "Český popis",
      caption: "Default caption",
      "caption-cs-CZ": "Český titulek",
    },
  },
  height: 1200,
  public_id: "gallery-one",
  secure_url: "https://example.test/gallery-one.jpg",
  width: 1600,
} as CloudinaryAsset;

describe("toGalleryPhotos", () => {
  test("uses locale-specific Cloudinary alt text and captions", () => {
    const [photo] = toGalleryPhotos([asset], "cs-CZ");

    expect(photo?.alt).toBe("Český popis");
    expect(photo?.caption).toBe("Český titulek");
  });

  test("skips empty Cloudinary alt text and captions", () => {
    const [photo] = toGalleryPhotos(
      [
        {
          ...asset,
          context: { custom: { alt: " ", "alt-en-US": "", caption: " " } },
        },
      ],
      "en-US",
      (index) => `Fallback ${index + 1}`
    );

    expect(photo?.alt).toBe("Fallback 1");
    expect(photo?.caption).toBeUndefined();
  });
});
