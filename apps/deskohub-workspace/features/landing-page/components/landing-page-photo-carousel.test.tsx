import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
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
  default: ({
    close,
    index,
    open,
    slides,
  }: {
    close: () => void;
    index: number;
    open: boolean;
    slides: readonly { alt?: string; title?: string }[];
  }) => (
    <>
      <output
        data-index={index}
        data-open={String(open)}
        data-testid="lightbox-slides"
      >
        {slides.map((slide) => `${slide.alt}|${slide.title ?? ""}`).join(";")}
      </output>
      <button data-testid="lightbox-close" onClick={close} type="button" />
    </>
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
  const photo = (index: number): VenuePhoto => ({
    alt: `Photo ${index}`,
    height: 1200,
    id: `photo-${index}`,
    lightbox: {
      alt: `Photo ${index}`,
      height: 1200,
      src: `https://example.test/photo-${index}-lightbox.jpg`,
      width: 1600,
    },
    publicId: `photo-${index}`,
    src: `https://example.test/photo-${index}.jpg`,
    width: 1600,
  });

  const renderCarousel = async (photos: readonly VenuePhoto[]) => {
    const { LandingPagePhotoCarousel } = await import(
      "./landing-page-photo-carousel"
    );
    return render(
      <LandingPagePhotoCarousel
        ariaLabel="Workspace photos"
        images={photos}
        locale="en-US"
      />
    );
  };

  const slideButtons = (view: ReturnType<typeof render>) =>
    Array.from(
      view.container.querySelectorAll<HTMLButtonElement>(
        "section > div:first-child > button"
      )
    );

  test("renders nothing without photos", async () => {
    const view = await renderCarousel([]);

    expect(view.container.innerHTML).toBe("");
  });

  test("shows a single photo alone as the current slide", async () => {
    const view = await renderCarousel([photo(1)]);
    const slides = slideButtons(view);

    expect(slides).toHaveLength(1);
    expect(slides[0]?.getAttribute("aria-current")).toBe("true");
    expect(slides[0]?.getAttribute("aria-label")).toBe(
      m.landingCarouselOpenCurrentPhoto({ number: 1 }, { locale: "en-US" })
    );
    expect(slides[0]?.className).toContain("cursor-zoom-in");
  });

  test("marks the current, side and hidden slides", async () => {
    const view = await renderCarousel([1, 2, 3, 4, 5].map(photo));
    const slides = slideButtons(view);

    expect(slides).toHaveLength(5);
    const [farLeft, left, current, right, farRight] = slides;
    expect(current?.getAttribute("aria-current")).toBe("true");
    for (const side of [left, right]) {
      expect(side?.disabled).toBe(false);
      expect(side?.getAttribute("aria-current")).toBeNull();
      expect(side?.getAttribute("aria-hidden")).toBeNull();
      expect(side?.className).toContain("cursor-pointer");
    }
    expect(right?.getAttribute("aria-label")).toBe(
      m.landingCarouselShowPhoto({ number: 2 }, { locale: "en-US" })
    );
    for (const hidden of [farLeft, farRight]) {
      expect(hidden?.disabled).toBe(true);
      expect(hidden?.getAttribute("aria-hidden")).toBe("true");
      expect(hidden?.tabIndex).toBe(-1);
      expect(hidden?.className).toContain("pointer-events-none");
    }
  });

  test("opens the current photo in the lightbox and closes it", async () => {
    const view = await renderCarousel([1, 2, 3].map(photo));
    const lightbox = view.getByTestId("lightbox-slides");

    expect(lightbox.dataset.open).toBe("false");
    fireEvent.click(
      view.getByRole("button", {
        name: m.landingCarouselOpenCurrentPhoto(
          { number: 1 },
          { locale: "en-US" }
        ),
      })
    );
    expect(lightbox.dataset.open).toBe("true");
    expect(lightbox.dataset.index).toBe("0");

    fireEvent.click(view.getByTestId("lightbox-close"));
    expect(lightbox.dataset.open).toBe("false");
    expect(lightbox.dataset.index).toBe("-1");
  });

  test("moves to a side photo when it is clicked", async () => {
    const view = await renderCarousel([1, 2, 3].map(photo));

    fireEvent.click(
      view.getByRole("button", {
        name: m.landingCarouselShowPhoto({ number: 2 }, { locale: "en-US" }),
      })
    );

    const current = slideButtons(view).find(
      (slide) => slide.getAttribute("aria-current") === "true"
    );
    expect(current?.getAttribute("aria-label")).toBe(
      m.landingCarouselOpenCurrentPhoto({ number: 2 }, { locale: "en-US" })
    );
    expect(view.getByTestId("lightbox-slides").dataset.open).toBe("false");
  });
});
