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

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({ alt }: { alt: string }) => (
    <span aria-label={alt} role="img" />
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

  test("keeps navigation manual without an autoplay control", async () => {
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

    expect(
      view.getByRole("button", {
        name: "Open carousel photo 1 in the lightbox",
      })
    ).toBeTruthy();
    expect(view.queryByRole("button", { name: "Pause carousel" })).toBeNull();
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
});
