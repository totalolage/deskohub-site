import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// The real CloudinaryImage runs, so its gallery defaults reach the image.
mock.module("next/image", () => ({
  default: ({
    alt,
    fetchPriority,
    preload,
    priority,
    sizes,
  }: {
    readonly alt: string;
    readonly fetchPriority?: string;
    readonly preload?: boolean;
    readonly priority?: boolean;
    readonly sizes?: string;
  }) => (
    <span
      aria-label={alt}
      data-image-fetch-priority={fetchPriority}
      data-image-preload={preload || priority ? "" : undefined}
      data-image-sizes={sizes}
      role="img"
    />
  ),
}));

mock.module("yet-another-react-lightbox", () => ({
  default: ({
    slides,
  }: {
    slides: readonly { alt?: string; title?: string }[];
  }) => (
    <output data-testid="lightbox-slides">
      {slides.map((slide) => `${slide.alt}|${slide.title ?? ""}`).join(";")}
    </output>
  ),
}));

const images: readonly VenuePhoto[] = [
  {
    alt: "Český popis",
    caption: "Český titulek",
    height: 1200,
    id: "landing-one",
    lightbox: {
      alt: "Český popis",
      description: "Český titulek",
      height: 1200,
      src: "https://example.test/landing-one-lightbox.jpg",
      title: "Český titulek",
      width: 1600,
    },
    publicId: "landing-one",
    src: "https://example.test/landing-one.jpg",
    width: 1600,
  },
  {
    alt: "Landing fallback alt",
    height: 1200,
    id: "landing-two",
    lightbox: {
      alt: "Landing fallback alt",
      height: 1200,
      src: "https://example.test/landing-two-lightbox.jpg",
      width: 1600,
    },
    publicId: "landing-two",
    src: "https://example.test/landing-two.jpg",
    width: 1600,
  },
];

describe("LandingPagePhotoCarousel", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders projected alt and caption and uses the projected lightbox", async () => {
    const { LandingPagePhotoCarousel } = await import(
      "./landing-page-photo-carousel"
    );
    const view = render(
      <LandingPagePhotoCarousel
        ariaLabel="Workspace photos"
        images={images}
        locale="cs-CZ"
      />
    );

    expect(view.getAllByRole("img", { name: "Český popis" })).not.toHaveLength(
      0
    );
    expect(
      view.getAllByRole("img", { name: "Landing fallback alt" })
    ).not.toHaveLength(0);
    expect(view.getByTestId("lightbox-slides").textContent).toBe(
      "Český popis|Český titulek;Landing fallback alt|"
    );
  });

  // The carousel sits below the fold, so no slide competes with the hero.
  test("loads every slide lazily at its slide width rather than the viewport's", async () => {
    const { LandingPagePhotoCarousel } = await import(
      "./landing-page-photo-carousel"
    );
    const view = render(
      <LandingPagePhotoCarousel
        ariaLabel="Workspace photos"
        images={images}
        locale="en-US"
      />
    );
    const slides = view.getAllByRole("img");

    expect(slides).not.toHaveLength(0);
    for (const slide of slides) {
      expect(slide.dataset.imagePreload).toBeUndefined();
      expect(slide.dataset.imageFetchPriority).not.toBe("high");
      expect(slide.dataset.imageSizes).toBeDefined();
      expect(slide.dataset.imageSizes).not.toBe("100vw");
    }
  });
});
