import { beforeAll, describe, expect, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { getImageAlt } from "../utils/get-image-alt";
import {
  galleryAsset,
  renderedImageAlts,
  renderOnLocaleRoute,
  routeLocale,
  settled,
} from "./gallery-render.test-utils";

let GalleryHeader: typeof import("./gallery-header").GalleryHeader;

beforeAll(async () => {
  setBoardgameTestEnv();
  ({ GalleryHeader } = await import("./gallery-header"));
});

const images = [galleryAsset("a"), galleryAsset("b"), galleryAsset("c")];

const buttonsIn = (html: string) =>
  [...html.matchAll(/<button[^>]*class="([^"]*)"/g)].map(([, name]) => name!);

describe("GalleryHeader", () => {
  test("shows every image starting at the first with slide controls", () => {
    const html = renderOnLocaleRoute(
      <GalleryHeader imagesPromise={settled(images)} />
    );

    expect(renderedImageAlts(html)).toEqual(
      images.map((image) => getImageAlt(image, routeLocale))
    );
    expect(html).toContain('style="transform:translateX(-0%)"');
    const buttons = buttonsIn(html);
    expect(buttons).toHaveLength(images.length + 2);
    expect(buttons.filter((name) => name.includes("w-8"))).toHaveLength(1);
    expect(html).not.toContain("<h1");
  });

  test("shows the title and description above the controls", () => {
    const html = renderOnLocaleRoute(
      <GalleryHeader
        imagesPromise={settled(images)}
        title="Gallery"
        description="Our tables"
      />
    );

    expect(html).toContain(">Gallery</h1>");
    expect(html).toContain(">Our tables</p>");
    expect(html.indexOf("</h1>")).toBeLessThan(html.indexOf("<button"));
  });

  test("shows a single image without controls", () => {
    const html = renderOnLocaleRoute(
      <GalleryHeader imagesPromise={settled([images[0]!])} title="Gallery" />
    );

    expect(renderedImageAlts(html)).toHaveLength(1);
    expect(buttonsIn(html)).toEqual([]);
    expect(html).toContain(">Gallery</h1>");
  });

  test("shows nothing without images", () => {
    expect(
      renderOnLocaleRoute(
        <GalleryHeader imagesPromise={settled([])} title="Gallery" />
      )
    ).toBe("");
  });
});
