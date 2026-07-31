import { describe, expect, test } from "bun:test";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { getLocalizedCloudinaryContextValue } from "./localized-cloudinary-context";

const asset = {
  context: {
    custom: {
      caption: "Default caption",
      "caption-cs-CZ": "Český popisek",
      "caption-en-US": "English caption",
      detail: "Default detail",
    },
  },
} as CloudinaryAsset;

describe("getLocalizedCloudinaryContextValue", () => {
  test("selects the requested locale", () => {
    expect(getLocalizedCloudinaryContextValue(asset, "caption", "cs-CZ")).toBe(
      "Český popisek"
    );
    expect(getLocalizedCloudinaryContextValue(asset, "caption", "en-US")).toBe(
      "English caption"
    );
  });

  test("falls back to the asset's global context value", () => {
    expect(getLocalizedCloudinaryContextValue(asset, "detail", "en-US")).toBe(
      "Default detail"
    );
  });
});
