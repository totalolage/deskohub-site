import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup } from "@testing-library/react";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let loadPhotos = (): Promise<readonly VenuePhoto[]> => Promise.resolve([]);

mock.module("@/features/gallery/backend/load-venue-photos.server", () => ({
  loadVenuePhotos: () => loadPhotos(),
}));
mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: ({ alt }: { alt: string }) => (
    <span aria-label={alt} role="img" />
  ),
}));
mock.module("yet-another-react-lightbox", () => ({ default: () => null }));

const { LandingPagePhotoCarouselSection } = await import(
  "./landing-page-photo-carousel-section"
);

describe("LandingPagePhotoCarouselSection", () => {
  beforeAll(() => registerWorkspaceComponentTestEnv());
  afterEach(() => cleanup());
  afterAll(() => unregisterWorkspaceComponentTestEnv());

  test("propagates redirect errors from the photo loader", async () => {
    loadPhotos = () =>
      Promise.reject(
        Object.assign(new Error("Redirect"), {
          digest: "NEXT_REDIRECT;replace;/en-US;307;",
        })
      );

    await expect(
      LandingPagePhotoCarouselSection({ locale: "en-US" })
    ).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  test("renders nothing when the loader returns no photos", async () => {
    loadPhotos = () => Promise.resolve([]);

    expect(
      await LandingPagePhotoCarouselSection({ locale: "en-US" })
    ).toBeNull();
  });
});
