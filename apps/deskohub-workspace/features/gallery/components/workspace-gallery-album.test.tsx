import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const lightbox = await import("yet-another-react-lightbox");
mock.module("yet-another-react-lightbox", () => ({
  ...lightbox,
  default: ({
    index,
    open,
    slides,
  }: {
    index: number;
    open: boolean;
    slides: readonly { src: string }[];
  }) => (
    <output data-index={index} data-open={open} data-testid="lightbox">
      {slides.map((slide) => slide.src).join("|")}
    </output>
  ),
}));

const photo = (id: string, caption?: string): VenuePhoto => ({
  alt: `Workspace ${id}`,
  ...(caption && { caption }),
  height: 600,
  id,
  lightbox: {
    alt: `Workspace ${id}`,
    height: 1200,
    src: `https://example.test/${id}-large.jpg`,
    width: 1600,
  },
  publicId: id,
  src: `https://example.test/${id}.jpg`,
  width: 800,
});

const photos = [
  photo("desk", "Quiet desks"),
  photo("kitchen"),
  photo("terrace"),
  photo("meeting-room", "Meeting room"),
];

describe("WorkspaceGalleryAlbum", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  /** The album as the server renders it, at its default width. */
  const renderAlbum = async (locale: "cs-CZ" | "en-US") => {
    const { WorkspaceGalleryAlbum } = await import("./workspace-gallery-album");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(
      <WorkspaceGalleryAlbum locale={locale} photos={photos} />
    );
    return container;
  };

  // Masonry columns reorder the photos in the markup.
  const byFirst = (left: readonly unknown[], right: readonly unknown[]) =>
    String(left[0]).localeCompare(String(right[0]));

  test("loads the first three photos eagerly and the rest lazily", async () => {
    const album = await renderAlbum("en-US");

    expect(
      [...album.querySelectorAll("img")]
        .map((image) => [
          image.getAttribute("src"),
          image.getAttribute("alt"),
          image.getAttribute("loading"),
          image.getAttribute("fetchpriority"),
        ])
        .toSorted(byFirst)
    ).toEqual(
      photos
        .map(({ alt, src }, index) =>
          index < 3 ? [src, alt, "eager", "high"] : [src, alt, "lazy", "auto"]
        )
        .toSorted(byFirst)
    );
  });

  test("labels each photo's button in the locale and captions only captioned photos", async () => {
    const album = await renderAlbum("cs-CZ");

    expect(
      [...album.querySelectorAll("button")]
        .map((button) => button.getAttribute("aria-label"))
        .toSorted()
    ).toEqual(
      photos
        .map((photo, index) =>
          m.galleryOpenImage(
            { image: photo.caption ?? photo.alt, number: index + 1 },
            { locale: "cs-CZ" }
          )
        )
        .toSorted()
    );
    expect(
      [...album.querySelectorAll("figcaption")]
        .map((caption) => caption.textContent)
        .toSorted()
    ).toEqual(["Meeting room", "Quiet desks"]);
  });

  test("hands every photo's lightbox image to a closed lightbox", async () => {
    const album = await renderAlbum("en-US");
    const lightbox = album.querySelector("output");

    expect(lightbox?.dataset.open).toBe("false");
    expect(lightbox?.textContent).toBe(
      photos.map(({ lightbox }) => lightbox.src).join("|")
    );
  });
});
