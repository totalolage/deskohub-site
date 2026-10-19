import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { ComponentProps } from "react";
import { prerender } from "react-dom/static";
import {
  getPublicCatalogOfferings,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import {
  currencyCZK,
  formatWorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { type Locale, locales, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const nextServer = await import("next/server");

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));
mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: Omit<ComponentProps<"a">, "href"> & {
    readonly href: string;
    readonly prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

type PriceListLoad = (
  locale: Locale
) =>
  | ReadonlyArray<PublicPriceListOffering>
  | Promise<ReadonlyArray<PublicPriceListOffering>>;

let sharedPriceList: PriceListLoad;
let variesByVisitor = false;
let visitorPriceList: PriceListLoad;
const loadVisitorPriceList = mock((locale: Locale) =>
  Promise.resolve(visitorPriceList(locale))
);
mock.module("@/features/pricing/backend/price-list.server", () => ({
  loadSharedPriceList: async (locale: Locale) => ({
    offerings: await sharedPriceList(locale),
    variesByVisitor,
    complete: true,
  }),
  loadVisitorPriceList,
}));

const { PricingPage } = await import("./pricing-page");

/** The catalog with a sale on Open Space and the office open. */
const saleOnOpenSpace = (locale: Locale) => {
  const [openSpace, ...rest] = getPublicCatalogOfferings({
    locale,
    office: { maximumSeats: 6 },
  });
  if (!openSpace) throw new Error("The catalog lists no cowork offering.");

  return [
    {
      ...openSpace,
      advertisedPrice: {
        price: currencyCZK(23_200),
        discount: currencyCZK(5800),
      },
    },
    ...rest,
  ];
};

const renderPage = async (locale: Locale, signal?: AbortSignal) => {
  const { prelude } = await prerender(<PricingPage locale={locale} />, {
    signal,
  });
  return new Response(prelude).text();
};

/**
 * The page as an agent that drops hidden elements reads it: React puts a
 * streamed Suspense segment in a hidden container until script reveals it.
 */
const visibleDocument = (html: string) => {
  const document = new DOMParser().parseFromString(html, "text/html");
  for (const element of document.querySelectorAll("[hidden], script")) {
    element.remove();
  }
  return document;
};

const visibleText = (html: string) =>
  visibleDocument(html).body.textContent ?? "";

const visibleLinks = (html: string) =>
  [...visibleDocument(html).querySelectorAll("a")].map((link) =>
    link.getAttribute("href")
  );

beforeAll(registerWorkspaceComponentTestEnv);
afterAll(unregisterWorkspaceComponentTestEnv);

beforeEach(() => {
  sharedPriceList = saleOnOpenSpace;
  variesByVisitor = false;
  visitorPriceList = saleOnOpenSpace;
  loadVisitorPriceList.mockClear();
});

describe("PricingPage", () => {
  for (const locale of locales) {
    test(`shows every price, the office, the sale, and the opening hours in the visible server HTML in ${locale}`, async () => {
      const html = await renderPage(locale);
      const text = visibleText(html);
      const price = (value: number) =>
        formatWorkspaceMoney(currencyCZK(value), locale);

      for (const expected of [
        m.pricingPageTitle({}, { locale }),
        m.pricingOpeningHoursSpace({}, { locale }),
        m.pricingOpeningHoursOpenSpace({ until: "17:00" }, { locale }),
        m.pricingOpeningHoursCodeAccess({}, { locale }),
        m.pricingPerDay({ price: price(29_000) }, { locale }),
        m.pricingPerDay({ price: price(41_000) }, { locale }),
        m.pricingAddOnPrice(
          {
            name: m.reservationCoffeeLabel({}, { locale }),
            price: price(5000),
          },
          { locale }
        ),
        m.pricingAddOnPrice(
          {
            name: m.reservationWorkstationLabel({}, { locale }),
            price: price(12_000),
          },
          { locale }
        ),
        m.pricingSalePrice(
          { price: price(23_200), regularPrice: price(29_000) },
          { locale }
        ),
        price(35_000),
        price(98_000),
        price(182_000),
        m.pricingPerDay({ price: price(53_000) }, { locale }),
        m.pricingOfficeSeatPrice({ price: price(31_500) }, { locale }),
      ]) {
        expect(text).toContain(expected);
      }
      // Nothing waits in a hidden container, and the request is never read.
      expect(html).not.toContain("hidden");
      expect(loadVisitorPriceList).not.toHaveBeenCalled();
      // The meeting-room durations share one usage sentence, shown once.
      expect(
        text.split(m.publicOfferingMeetingRoomUsage({}, { locale })).length
      ).toBe(2);

      const links = visibleLinks(html);
      for (const href of [
        `/${locale}/reservation/cowork?entryTier=open-space`,
        `/${locale}/reservation/cowork?entryTier=reserved-desk`,
        `/${locale}/reservation/meeting-room?duration=hour%3A1`,
        `/${locale}/reservation/meeting-room?duration=hour%3A4`,
        `/${locale}/reservation/meeting-room?duration=day%3A1`,
        `/${locale}/reservation/office`,
        `/${locale}/contact`,
      ]) {
        expect(links).toContain(href);
      }
    });
  }

  test("says the space is open 24/7 and Open Space closes at 17:00", async () => {
    const text = visibleText(await renderPage("en-US"));

    expect(text).toContain("The space is open 24/7");
    expect(text).toContain("until 17:00");
    expect(text).toContain("24/7 code access");
  });

  test("keeps the shared prices visible while a gate decided per visitor streams the visitor's list", async () => {
    // A gate decided per visitor stays closed in the shared list.
    sharedPriceList = (locale) => getPublicCatalogOfferings({ locale });
    variesByVisitor = true;
    visitorPriceList = () => new Promise(() => {});
    // Aborting keeps the shell that Next.js prerenders, without the stream.
    const html = await renderPage("en-US", AbortSignal.timeout(100));
    const text = visibleText(html);
    const price = (value: number) =>
      formatWorkspaceMoney(currencyCZK(value), "en-US");

    for (const expected of [
      m.pricingPerDay({ price: price(29_000) }, { locale: "en-US" }),
      m.pricingPerDay({ price: price(41_000) }, { locale: "en-US" }),
      price(35_000),
      price(98_000),
      price(182_000),
    ]) {
      expect(text).toContain(expected);
    }
    expect(loadVisitorPriceList).toHaveBeenCalledTimes(1);
    expect(html).not.toContain('id="pricing-office-title"');
  });

  test("lists catalog prices without a sale line when no quote answered", async () => {
    sharedPriceList = (locale) => getPublicCatalogOfferings({ locale });
    const html = await renderPage("en-US");
    const text = visibleText(html);

    expect(text).toContain(
      m.pricingPerDay(
        { price: formatWorkspaceMoney(currencyCZK(29_000), "en-US") },
        { locale: "en-US" }
      )
    );
    expect(text).not.toContain("On sale today");
    // The office is listed only while its release gate is on.
    expect(html).not.toContain('id="pricing-office-title"');
    expect(html).not.toContain("/en-US/reservation/office");
  });
});
