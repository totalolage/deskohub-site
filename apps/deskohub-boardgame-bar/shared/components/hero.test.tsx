import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import type { ICloudinaryService } from "@deskohub/cloudinary/server";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { Effect, Layer } from "effect";
import type { ReactElement } from "react";
import { galleryAsset } from "@/features/gallery/components/gallery-render.test-utils";
import { getImageAlt } from "@/features/gallery/utils/get-image-alt";
import { getLocale } from "@/features/i18n";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

const listTaggedAssets = mock<ICloudinaryService["listTaggedAssets"]>(() =>
  Effect.succeed([])
);

let Hero: typeof import("./hero").Hero;

beforeAll(async () => {
  const { CloudinaryService } = await import("@deskohub/cloudinary/server");
  const nextCache = await import("next/cache");

  mock.module("@/features/gallery/backend/cloudinary.service", () => ({
    GalleryCloudinaryLayer: Layer.mock(CloudinaryService, { listTaggedAssets }),
  }));
  mock.module("next/cache", () => ({ ...nextCache, cacheTag: () => {} }));

  ({ Hero } = await import("./hero"));
});

const blurImageBytes = new Uint8Array([1, 2, 3]);
const fetchedUrls: string[] = [];

let restoreFetch: (() => void) | undefined;

beforeEach(() => {
  listTaggedAssets.mockClear();
  listTaggedAssets.mockImplementation(() => Effect.succeed([]));
  fetchedUrls.length = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: string | URL | Request
  ) => {
    fetchedUrls.push(String(input));
    return new Response(blurImageBytes, {
      headers: { "content-type": "image/webp" },
    });
  }) as typeof fetch);
  restoreFetch = () => fetchSpy.mockRestore();
});

afterEach(() => {
  restoreFetch?.();
});

const showAssets = (assets: CloudinaryAsset[]) => {
  listTaggedAssets.mockImplementation(() => Effect.succeed(assets));
};

const content = <p>Welcome</p>;

const classesOf = (element: ReactElement<{ className?: string }>) =>
  element.props.className?.split(" ");

describe("Hero", () => {
  test("shows the first hero image for the tags with a blur placeholder", async () => {
    const image = galleryAsset("bar/hero/tables");
    showAssets([image]);

    const hero = await Hero({ tags: ["Web galerie"], children: content });

    expect(listTaggedAssets).toHaveBeenCalledWith([["Web galerie", "hero"]], {
      maxResults: 1,
    });
    expect(fetchedUrls).toHaveLength(1);
    expect(
      findElementsOfType(hero, CloudinaryImage).map(({ props }) => ({
        source: props.source,
        alt: props.alt,
        variant: props.variant,
        blurDataURL: props.blurDataURL,
      }))
    ).toEqual([
      {
        source: image,
        alt: getImageAlt(image, getLocale()),
        variant: "hero",
        blurDataURL: `data:image/webp;base64,${Buffer.from(blurImageBytes).toString("base64")}`,
      },
    ]);
  });

  test("shows only the content when no hero image matches", async () => {
    const hero = await Hero({ tags: ["Web galerie"], children: content });

    expect(findElementsOfType(hero, CloudinaryImage)).toEqual([]);
    expect(findElementsOfType(hero, "p")).toEqual([content]);
    expect(fetchedUrls).toEqual([]);
  });

  test("defaults to a compact, centered section", async () => {
    const hero = await Hero({ tags: ["Web galerie"], children: content });
    const [aligned] = findElementsOfType(hero, "div");

    expect(classesOf(hero)).toContain("min-h-96");
    expect(classesOf(aligned!)).toContain("text-center");
  });

  test("fills the viewport and aligns left when asked, keeping extra classes", async () => {
    const hero = await Hero({
      tags: ["Web galerie"],
      fullHeight: true,
      alignment: "left",
      className: "bg-black",
      children: content,
    });
    const [aligned] = findElementsOfType(hero, "div");

    expect(classesOf(hero)).toContain(
      "min-h-[calc(100dvh_-_var(--header-height)_-_90px)]"
    );
    expect(classesOf(hero)).toContain("bg-black");
    expect(classesOf(aligned!)).toContain("text-left");
  });
});
