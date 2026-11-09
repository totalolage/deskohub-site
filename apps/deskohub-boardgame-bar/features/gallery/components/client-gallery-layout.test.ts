import { describe, expect, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import {
  fitImageToContainer,
  galleryColumnClasses,
  galleryImageCaption,
  lightboxOpenTrackingData,
} from "./client-gallery-layout";

const image = (caption?: string) =>
  ({
    public_id: "bar/tables/window",
    width: 1600,
    height: 900,
    context: caption === undefined ? undefined : { custom: { caption } },
  }) as CloudinaryAsset;

describe("galleryColumnClasses", () => {
  test("sets the column count for each configured breakpoint", () => {
    expect(
      galleryColumnClasses({ sm: 2, md: 3, lg: 4, xl: 6 }).filter(Boolean)
    ).toEqual([
      "sm:grid-cols-2",
      "md:grid-cols-3",
      "lg:grid-cols-4",
      "xl:grid-cols-6",
    ]);
  });

  test("leaves out breakpoints without a column count", () => {
    expect(galleryColumnClasses({ md: 3 }).filter(Boolean)).toEqual([
      "md:grid-cols-3",
    ]);
    expect(galleryColumnClasses({}).filter(Boolean)).toEqual([]);
  });
});

describe("fitImageToContainer", () => {
  test("fits an image wider than the container to its width", () => {
    expect(
      fitImageToContainer(
        { width: 1600, height: 900 },
        { width: 800, height: 800 }
      )
    ).toEqual({ width: 800, height: 450 });
  });

  test("fits an image taller than the container to its height", () => {
    expect(
      fitImageToContainer(
        { width: 600, height: 1200 },
        { width: 800, height: 600 }
      )
    ).toEqual({ width: 300, height: 600 });
  });

  test("fills a container with the same aspect ratio", () => {
    expect(
      fitImageToContainer(
        { width: 400, height: 300 },
        { width: 800, height: 600 }
      )
    ).toEqual({ width: 800, height: 600 });
  });
});

describe("galleryImageCaption", () => {
  test("reads the image's caption", () => {
    expect(galleryImageCaption(image("Window table"))).toBe("Window table");
  });

  test("has no caption without Cloudinary context", () => {
    expect(galleryImageCaption(image())).toBeUndefined();
    expect(
      galleryImageCaption({ ...image(), context: {} } as CloudinaryAsset)
    ).toBeUndefined();
  });
});

describe("lightboxOpenTrackingData", () => {
  test("identifies the opened image and its caption", () => {
    expect(lightboxOpenTrackingData(image("Window table"), 2)).toEqual({
      imageId: "bar/tables/window",
      imageIndex: 2,
      imageCaption: "Window table",
    });
  });

  test("omits an empty or missing caption", () => {
    expect(lightboxOpenTrackingData(image(""), 0)).toEqual({
      imageId: "bar/tables/window",
      imageIndex: 0,
    });
    expect(lightboxOpenTrackingData(image(), 1)).toEqual({
      imageId: "bar/tables/window",
      imageIndex: 1,
    });
  });
});
