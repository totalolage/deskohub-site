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
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("server-only", () => ({}));

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

mock.module("@/features/gallery/actions/get-cloudinary-images", () => ({
  getCloudinaryImages: () => Promise.resolve([]),
}));

mock.module("@deskohub/cloudinary-image", () => ({
  CloudinaryImage: () => null,
}));

mock.module("next/image", () => ({
  default: () => null,
}));

mock.module("yet-another-react-lightbox", () => ({
  default: () => null,
}));

describe("TtrpgRoomPage", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("starts a meeting-room reservation from the workspace room option", async () => {
    const { RoomCarouselFallback, TtrpgRoomPage } = await import("./page");
    const view = render(
      <TtrpgRoomPage
        barCarousel={<RoomCarouselFallback label="Bar room photos" />}
        locale="en-US"
        workspaceCarousel={<RoomCarouselFallback label="Workspace photos" />}
      />
    );

    expect(
      view.getByRole("link", { name: "Reserve" }).getAttribute("href")
    ).toBe("/en-US/reservation/meeting-room");
    expect(
      view
        .getByRole("link", { name: "Contact Deskohub Bar" })
        .getAttribute("href")
    ).toStartWith("https://bar.deskohub.cz/en-US/contact?");
    expect(view.getAllByRole("region")).toHaveLength(2);
    for (const carousel of view.getAllByRole("region")) {
      expect(carousel.getAttribute("aria-busy")).toBe("true");
    }
  });

  test("reserves the carousel layout while room images load", async () => {
    const { RoomCarouselFallback } = await import("./page");
    const view = render(<RoomCarouselFallback label="Loading room photos" />);
    const fallback = view.getByRole("region", {
      name: "Loading room photos",
    });

    expect(fallback.getAttribute("aria-busy")).toBe("true");
    expect(fallback.getAttribute("class")).toContain("space-y-3");
    expect(fallback.firstElementChild?.getAttribute("class")).toContain(
      "aspect-[4/3]"
    );
  });
});
