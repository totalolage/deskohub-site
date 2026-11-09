import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ComponentProps, ReactElement } from "react";
import type Lightbox from "yet-another-react-lightbox";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { getImageAlt } from "../utils/get-image-alt";
import type { GalleryImage } from "./client-gallery-items";
import {
  galleryAsset,
  renderedImageAlts,
  renderOnLocaleRoute,
  routeLocale,
  settled,
} from "./gallery-render.test-utils";

type LightboxProps = ComponentProps<typeof Lightbox>;

const lightboxes: LightboxProps[] = [];

let ClientGallery: typeof import("./client-gallery").ClientGallery;
let LightboxSlide: typeof import("./client-gallery-items").LightboxSlide;

beforeAll(async () => {
  setBoardgameTestEnv();
  const lightbox = await import("yet-another-react-lightbox");
  mock.module("yet-another-react-lightbox", () => ({
    ...lightbox,
    default: (props: LightboxProps) => {
      lightboxes.push(props);
      return null;
    },
  }));
  ({ ClientGallery } = await import("./client-gallery"));
  ({ LightboxSlide } = await import("./client-gallery-items"));
});

beforeEach(() => {
  lightboxes.length = 0;
});

const images = [
  galleryAsset("a", "Window table"),
  galleryAsset("b"),
  galleryAsset("c"),
];
const alts = images.map((image) => getImageAlt(image, routeLocale));
const blurUrls = { a: "data:image/webp;base64,AA" };

const gridClassOf = (html: string) =>
  html.match(/^<div class="([^"]*)"/)?.[1]?.split(" ");

describe("ClientGallery", () => {
  test("shows a card per image with captions in a responsive grid", () => {
    const html = renderOnLocaleRoute(
      <ClientGallery
        imagesPromise={settled(images)}
        blurUrlsPromise={settled(blurUrls)}
        className="mt-8"
      />
    );

    expect(gridClassOf(html)).toEqual([
      "grid",
      "grid-cols-1",
      "gap-4",
      "sm:grid-cols-2",
      "md:grid-cols-3",
      "lg:grid-cols-4",
      "mt-8",
    ]);
    expect(renderedImageAlts(html)).toEqual(alts);
    expect(html.match(/<p class="text-sm text-gray-600">/g)).toHaveLength(1);
    expect(html).toContain(">Window table</p>");
  });

  test("uses the configured column counts", () => {
    const html = renderOnLocaleRoute(
      <ClientGallery
        imagesPromise={settled(images)}
        columns={{ md: 2, xl: 5 }}
      />
    );

    expect(gridClassOf(html)).toEqual([
      "grid",
      "grid-cols-1",
      "gap-4",
      "md:grid-cols-2",
      "xl:grid-cols-5",
    ]);
  });

  test("offers every image in a closed lightbox showing each fitted slide", () => {
    renderOnLocaleRoute(
      <ClientGallery
        imagesPromise={settled(images)}
        blurUrlsPromise={settled(blurUrls)}
      />
    );

    expect(lightboxes).toHaveLength(1);
    const [lightbox] = lightboxes;
    expect(lightbox!.open).toBeFalse();
    expect(lightbox!.index).toBe(0);
    expect(lightbox!.slides).toEqual([
      { src: "0" },
      { src: "1" },
      { src: "2" },
    ]);

    const rect = { width: 800, height: 800 };
    const slide = lightbox!.render!.slide!({
      slide: lightbox!.slides![0]!,
      offset: 0,
      rect,
    }) as ReactElement<{ image: GalleryImage; container: typeof rect }>;
    expect(slide.type).toBe(LightboxSlide);
    expect(slide.props).toEqual({
      image: { source: images[0]!, alt: alts[0]!, blurDataURL: blurUrls.a },
      container: rect,
    });
  });

  test("leaves out the lightbox when it is disabled", () => {
    const html = renderOnLocaleRoute(
      <ClientGallery imagesPromise={settled(images)} enableLightbox={false} />
    );

    expect(renderedImageAlts(html)).toEqual(alts);
    expect(lightboxes).toEqual([]);
  });

  test("shows a notice instead of the grid without images", () => {
    const html = renderOnLocaleRoute(
      <ClientGallery imagesPromise={settled([])} />
    );

    expect(html).toStartWith('<div class="text-center py-12"><p');
    expect(renderedImageAlts(html)).toEqual([]);
    expect(lightboxes).toEqual([]);
  });

  test("shows the minimal variant as round images without cards or a lightbox", () => {
    const html = renderOnLocaleRoute(
      <ClientGallery
        imagesPromise={settled(images)}
        variant="minimal"
        className="mt-8"
      />
    );

    expect(
      html.match(/rounded-full overflow-hidden aspect-square/g)
    ).toHaveLength(images.length);
    expect(renderedImageAlts(html)).toEqual(alts);
    expect(html).not.toContain("<p");
    expect(lightboxes).toEqual([]);
  });

  test("shows nothing for the minimal variant without images", () => {
    expect(
      renderOnLocaleRoute(
        <ClientGallery imagesPromise={settled([])} variant="minimal" />
      )
    ).toBe("");
  });
});
