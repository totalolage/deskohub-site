import { describe, expect, mock, test } from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import type { ReactElement } from "react";
import { Card } from "@/shared/components/ui/card";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import {
  type GalleryImage,
  GalleryImageCard,
  LightboxSlide,
  MinimalGallery,
} from "./client-gallery-items";

const galleryImage = (publicId: string, caption?: string): GalleryImage => ({
  source: {
    public_id: publicId,
    width: 1600,
    height: 900,
    context: caption ? { custom: { caption } } : undefined,
  } as CloudinaryAsset,
  alt: `Alt for ${publicId}`,
  blurDataURL: `data:image/webp;base64,${publicId}`,
});

const imagesIn = (tree: ReturnType<typeof MinimalGallery>) =>
  findElementsOfType(tree, CloudinaryImage).map(({ props }) => ({
    source: props.source,
    alt: props.alt,
    blurDataURL: props.blurDataURL,
    variant: props.variant,
    preload: props.preload,
  }));

describe("MinimalGallery", () => {
  test("shows each image preloaded with its alt text and placeholder", () => {
    const tree = MinimalGallery({
      images: [galleryImage("a"), galleryImage("b")],
      className: "mt-8",
    }) as ReactElement<{ className: string }>;

    expect(tree.props.className).toEndWith(" mt-8");
    expect(imagesIn(tree)).toEqual(
      ["a", "b"].map((id) => ({
        source: galleryImage(id).source,
        alt: `Alt for ${id}`,
        blurDataURL: `data:image/webp;base64,${id}`,
        variant: "gallery",
        preload: true,
      }))
    );
  });

  test("shows nothing without images", () => {
    expect(MinimalGallery({ images: [], className: "" })).toBeNull();
  });
});

describe("GalleryImageCard", () => {
  test("opens the image on click and shows its thumbnail and caption", () => {
    const onClick = mock();
    const tree = GalleryImageCard({
      image: galleryImage("a", "Window table"),
      onClick,
    });

    const [card] = findElementsOfType(tree, Card);
    card!.props.onClick!({} as never);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(
      findElementsOfType(tree, CloudinaryImage).map(
        ({ props }) => props.variant
      )
    ).toEqual(["thumbnail"]);
    expect(
      findElementsOfType(tree, "p").map(({ props }) => props.children)
    ).toEqual(["Window table"]);
  });

  test("shows no caption for an image without one", () => {
    const tree = GalleryImageCard({
      image: galleryImage("a"),
      onClick: mock(),
    });

    expect(findElementsOfType(tree, "p")).toEqual([]);
  });
});

describe("LightboxSlide", () => {
  test("shows the full image fitted inside the slide", () => {
    const tree = LightboxSlide({
      image: galleryImage("a"),
      container: { width: 800, height: 800 },
    });

    expect(
      findElementsOfType(tree, CloudinaryImage).map(({ props }) => ({
        alt: props.alt,
        blurDataURL: props.blurDataURL,
        variant: props.variant,
        size: props.size,
      }))
    ).toEqual([
      {
        alt: "Alt for a",
        blurDataURL: "data:image/webp;base64,a",
        variant: "full",
        size: { width: 800, height: 450 },
      },
    ]);
  });
});
