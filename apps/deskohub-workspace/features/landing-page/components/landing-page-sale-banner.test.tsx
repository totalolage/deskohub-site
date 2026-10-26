import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Schema } from "effect";
import type { ComponentProps } from "react";
import {
  type DiscountAdjustment,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { workspaceProductFamilies } from "@/features/discounts/product-target";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { SALE_BANNER_CLICKED_EVENT } from "../landing-page-sale-banner-analytics";
import { getLandingPageSaleBannerContent } from "../landing-page-sale-banner-content";
import { LandingPageSaleBanner } from "./landing-page-sale-banner";

type SaleBannerClickProperties = {
  readonly discount_id: string;
  readonly locale: Locale;
  readonly reservation_kind: string;
};

const posthogCapture = mock(
  (_event: string, _properties?: SaleBannerClickProperties) => undefined
);

mock.module("posthog-js", () => ({
  default: { capture: posthogCapture },
}));

mock.module("next/link", () => ({
  default: ({
    href,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & { readonly href: string | URL }) => (
    <a href={href.toString()} {...props} />
  ),
}));

const setAnalyticsConsent = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: This test sets the cookie consumed by the analytics boundary.
  document.cookie = `cc_cookie=${encodeURIComponent(
    JSON.stringify({ categories: ["necessary", "analytics"] })
  )}; Path=/`;
};

const clearAnalyticsConsent = () => {
  // biome-ignore lint/suspicious/noDocumentCookie: This test clears the consent cookie between cases.
  document.cookie = "cc_cookie=; Path=/; Max-Age=0";
};

/**
 * Clicks the banner link and reports whether the banner's click handler
 * prevented the default action, then stops the test DOM from navigating.
 */
const clickBannerLink = (link: HTMLElement) => {
  let navigationPrevented: boolean | undefined;
  const stopNavigation = (event: Event) => {
    navigationPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stopNavigation);
  fireEvent.click(link);
  document.removeEventListener("click", stopNavigation);
  return { navigationPrevented };
};

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
    sale: {
      id: Schema.decodeUnknownSync(discountIdSchema)("summer-focus"),
      title,
      adjustment,
      products: [{ kind: "cowork" }],
    },
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
  // Cookies need a real origin; the blank test page drops them.
  window.happyDOM.setURL("https://deskohub.test/");
});

afterEach(() => {
  cleanup();
  clearAnalyticsConsent();
  posthogCapture.mockClear();
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

  test("reports a consented click once without blocking the link", async () => {
    setAnalyticsConsent();
    const content = coworkSaleBannerContent({ locale: "cs-CZ" });
    const view = render(<LandingPageSaleBanner content={content} />);
    const link = view.getByRole("link");

    expect(link.getAttribute("href")).toBe(content.href);
    expect(link.getAttribute("href")).not.toContain("utm_");
    expect(clickBannerLink(link).navigationPrevented).toBe(false);
    await waitFor(() => expect(posthogCapture).toHaveBeenCalledTimes(1));
    expect(posthogCapture).toHaveBeenCalledWith(SALE_BANNER_CLICKED_EVENT, {
      discount_id: "summer-focus",
      locale: "cs-CZ",
      reservation_kind: "cowork",
    });
  });

  test("reports nothing without analytics consent", async () => {
    const view = render(
      <LandingPageSaleBanner content={coworkSaleBannerContent()} />
    );

    expect(clickBannerLink(view.getByRole("link")).navigationPrevented).toBe(
      false
    );
    await Promise.resolve();
    expect(posthogCapture).not.toHaveBeenCalled();
  });
});
