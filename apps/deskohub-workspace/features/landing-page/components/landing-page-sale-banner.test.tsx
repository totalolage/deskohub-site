import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { workspaceProductFamilies } from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { getLandingPageSaleBannerContent } from "../landing-page-sale-banner-content";
import { LandingPageSaleBanner } from "./landing-page-sale-banner";

const coworkSaleBannerContent = ({
  locale = "en-US",
  title = "Summer focus",
  adjustment = { kind: "percentage", basisPoints: 2000 },
}: {
  locale?: Locale;
  title?: string;
  adjustment?: DiscountAdjustment;
} = {}) =>
  getLandingPageSaleBannerContent({
    bookableProducts: workspaceProductFamilies,
    locale,
    reservationKind: "cowork",
    sale: { title, adjustment, products: [{ kind: "cowork" }] },
  });

/** The cowork sale sentence as visitors read it, without the highlight markup. */
const coworkSaleLabelText = (
  locale: Locale,
  title: string,
  adjustment: string
) =>
  m
    .landingSaleBannerAllCoworkProducts({ title, adjustment }, { locale })
    .replace(/<\/?discount>/g, "");

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("LandingPageSaleBanner", () => {
  test.each([
    ["en-US" as const, "Autumn <VIP>"],
    ["en-US" as const, "Autumn {discount}"],
    ["en-US" as const, "Autumn <b>VIP</b>"],
  ])("renders the %s sale title %p as literal text", (locale, title) => {
    const content = coworkSaleBannerContent({ locale, title });
    const { container } = render(<LandingPageSaleBanner content={content} />);
    const paragraph = container.querySelector("p");
    const values = container.querySelectorAll(
      "[data-landing-sale-discount-value]"
    );

    expect(paragraph?.textContent).toBe(
      coworkSaleLabelText(locale, title, content.label.adjustment)
    );
    expect(paragraph?.querySelector("b")).toBeNull();
    expect(values).toHaveLength(1);
    expect(values[0]?.textContent).toBe(content.label.adjustment);
  });
});
