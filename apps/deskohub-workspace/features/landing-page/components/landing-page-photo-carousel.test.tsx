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
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { m } from "@/features/i18n";
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
  default: ({ slides }: { slides: readonly { alt?: string }[] }) => (
    <output data-testid="lightbox-slides">
      {slides.map((slide) => slide.alt).join("|")}
    </output>
  ),
}));

const images = [
  {
    height: 1200,
    public_id: "landing-one",
    secure_url: "https://example.test/landing-one.jpg",
    width: 1600,
  },
  {
    height: 1200,
    public_id: "landing-two",
    secure_url: "https://example.test/landing-two.jpg",
    width: 1600,
  },
] as readonly CloudinaryAsset[];

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

  test("uses the locale-specific Cloudinary alt text and skips empty values", async () => {
    const { LandingPagePhotoCarousel } = await import(
      "./landing-page-photo-carousel"
    );
    const localizedImages = [
      {
        ...images[0]!,
        context: {
          custom: {
            alt: "Default alt",
            "alt-cs-CZ": "Český popis",
            "alt-en-US": "English alt",
          },
        },
      },
      {
        ...images[1]!,
        context: { custom: { alt: " ", "alt-cs-CZ": "" } },
      },
    ] as readonly CloudinaryAsset[];
    const view = render(
      <LandingPagePhotoCarousel
        ariaLabel="Workspace photos"
        images={localizedImages}
        locale="cs-CZ"
      />
    );
    const fallbackAlt = m.landingCarouselImageAlt(
      { number: 2 },
      { locale: "cs-CZ" }
    );

    expect(view.getAllByRole("img", { name: "Český popis" })).not.toHaveLength(
      0
    );
    expect(view.getAllByRole("img", { name: fallbackAlt })).not.toHaveLength(0);
    expect(view.getByTestId("lightbox-slides").textContent).toBe(
      `Český popis|${fallbackAlt}`
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
