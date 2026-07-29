import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  LandingPageSaleBanner,
  type LandingPageSaleBannerContent,
} from "./landing-page-sale-banner";

const content = {
  label: "Summer focus: 20% off cowork access!",
  statusLabel: "Sale active",
  ctaLabel: "Book with discount",
  href: "/en-US/reserve/cowork",
} satisfies Omit<LandingPageSaleBannerContent, "adjustmentKind">;

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageSaleBanner", () => {
  test.each([
    ["percentage" as const, ".lucide-percent"],
    ["fixed" as const, ".lucide-dollar-sign"],
  ])("renders the %s adjustment icon", (adjustmentKind, selector) => {
    const { container } = render(
      <LandingPageSaleBanner content={{ ...content, adjustmentKind }} />
    );

    expect(container.querySelector(selector)).not.toBeNull();
  });
});
