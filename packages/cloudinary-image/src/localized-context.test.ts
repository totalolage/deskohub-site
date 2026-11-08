import { describe, expect, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { getLocalizedCloudinaryContextValue } from "./localized-context";

const assetWith = (
  custom: NonNullable<NonNullable<CloudinaryAsset["context"]>["custom"]>
) => ({ context: { custom } }) as CloudinaryAsset;

describe("getLocalizedCloudinaryContextValue", () => {
  test("reads the locale's own value first", () => {
    const asset = assetWith({
      "caption-cs-CZ": " Czech ",
      "caption-en-US": "English",
      caption: "Bare",
    });

    expect(getLocalizedCloudinaryContextValue(asset, "caption", "cs-CZ")).toBe(
      "Czech"
    );
    expect(getLocalizedCloudinaryContextValue(asset, "caption", "en-US")).toBe(
      "English"
    );
  });

  test("falls back to the base locale's value before the bare value", () => {
    const asset = assetWith({ "alt-en-US": "English", alt: "Bare" });

    expect(getLocalizedCloudinaryContextValue(asset, "alt", "cs-CZ")).toBe(
      "English"
    );
  });

  test("falls back to the bare value when neither locale has one", () => {
    const asset = assetWith({ "detail-cs-CZ": "  ", detail: "Bare" });

    expect(getLocalizedCloudinaryContextValue(asset, "detail", "cs-CZ")).toBe(
      "Bare"
    );
    expect(getLocalizedCloudinaryContextValue(asset, "detail", "en-US")).toBe(
      "Bare"
    );
  });

  test("never reads another locale's value for the base locale", () => {
    const asset = assetWith({ "alt-cs-CZ": "Czech" });

    expect(
      getLocalizedCloudinaryContextValue(asset, "alt", "en-US")
    ).toBeUndefined();
  });
});
