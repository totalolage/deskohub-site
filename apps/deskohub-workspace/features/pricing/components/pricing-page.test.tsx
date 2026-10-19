import { describe, expect, mock, test } from "bun:test";
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

let priceList: (locale: Locale) => ReadonlyArray<PublicPriceListOffering>;
mock.module("@/features/pricing/backend/price-list.server", () => ({
  loadPriceList: (locale: Locale) => Promise.resolve(priceList(locale)),
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

const renderPage = async (locale: Locale) => {
  const { prelude } = await prerender(<PricingPage locale={locale} />);
  return new Response(prelude).text();
};

describe("PricingPage", () => {
  for (const locale of locales) {
    test(`renders every price and the opening hours in the server HTML in ${locale}`, async () => {
      priceList = saleOnOpenSpace;
      const html = await renderPage(locale);
      const price = (value: number) =>
        formatWorkspaceMoney(currencyCZK(value), locale);

      for (const text of [
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
        expect(html).toContain(text);
      }
      expect(html).toContain("17:00");

      for (const href of [
        `/${locale}/reservation/cowork?entryTier=open-space`,
        `/${locale}/reservation/cowork?entryTier=reserved-desk`,
        `/${locale}/reservation/meeting-room?duration=hour%3A1`,
        `/${locale}/reservation/meeting-room?duration=hour%3A4`,
        `/${locale}/reservation/meeting-room?duration=day%3A1`,
        `/${locale}/reservation/office"`,
        `/${locale}/contact"`,
      ]) {
        expect(html).toContain(`href="${href}`);
      }
    });
  }

  test("says the space is open 24/7 and Open Space closes at 17:00", async () => {
    priceList = saleOnOpenSpace;
    const html = await renderPage("en-US");

    expect(html).toContain("The space is open 24/7");
    expect(html).toContain("until 17:00");
    expect(html).toContain("24/7 code access");
  });

  test("lists catalog prices without a sale line when no quote answered", async () => {
    priceList = (locale) => getPublicCatalogOfferings({ locale });
    const html = await renderPage("en-US");

    expect(html).toContain(
      m.pricingPerDay(
        { price: formatWorkspaceMoney(currencyCZK(29_000), "en-US") },
        { locale: "en-US" }
      )
    );
    expect(html).not.toContain("On sale today");
    // The office is listed only while its release gate is on.
    expect(html).not.toContain('id="pricing-office-title"');
    expect(html).not.toContain("/en-US/reservation/office");
  });
});
