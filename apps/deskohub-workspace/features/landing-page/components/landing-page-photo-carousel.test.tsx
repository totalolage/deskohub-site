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
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: () => null,
}));

mock.module("yet-another-react-lightbox", () => ({
  default: () => null,
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

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
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
});
