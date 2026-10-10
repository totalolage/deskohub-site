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
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const syntheticImageUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E";

mock.module("next/image", () => ({
  default: () => null,
  getImageProps: ({ alt }: { readonly alt: string }) => ({
    props: { alt, src: syntheticImageUrl },
  }),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageHeroSection", () => {
  test("names hero CTA links by their visible copy only", async () => {
    const { LandingPageHeroSection } = await import(
      "./landing-page-hero-section"
    );
    const view = render(
      <LandingPageHeroSection
        locale="en-US"
        meetingRoomPageEnabled
        overviewSectionId="overview"
      />
    );

    for (const name of [
      m.landingHeroMeetingRoomCta({}, { locale: "en-US" }),
      m.landingHeroPrimaryCta({}, { locale: "en-US" }),
    ]) {
      expect(view.getByRole("link", { name }).textContent).toBe(name);
    }
  });
});
