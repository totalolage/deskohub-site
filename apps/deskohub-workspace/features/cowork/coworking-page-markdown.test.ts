import { describe, expect, test } from "bun:test";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import { type Locale, locales, m } from "@/features/i18n";
import { getOfferingSale } from "@/features/pricing/offering-sale";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { formatMoney } from "@/shared/money/money";
import { getCoworkingDesks } from "./coworking-page-content";
import { coworkingPageMarkdown } from "./coworking-page-markdown";

const render = (locale: Locale, discountValue = 0) =>
  serializeMarkdown(
    coworkingPageMarkdown(
      locale,
      advertisedCatalogOfferings({ discountValue, locale })
    )
  );

// The Markdown plain text collapses the no-break spaces in formatted money.
const plainText = (text: string) => text.replace(/\s+/g, " ").trim();

/** The sale line a desk shows during a sale of 50 CZK. */
const saleLine = (locale: Locale, tier: "open-space" | "reserved-desk") => {
  const offering = advertisedCatalogOfferings({
    discountValue: 5_000,
    locale,
  }).find(
    (candidate) => candidate.kind === "cowork" && candidate.tier === tier
  );
  const sale = offering && getOfferingSale(offering, locale);
  if (!sale) throw new Error(`Expected a sale on ${tier}`);
  return plainText(m.pricingSalePrice(sale, { locale }));
};

// Left out on purpose: the metadata title and description, the breadcrumbs,
// the in-page link to the desks, the day ruler and the photos.
describe.each(locales)("coworkingPageMarkdown in %s", (locale) => {
  test("starts with the page heading and covers both desks at their catalog price", () => {
    const markdown = render(locale);
    const text = markdownPlainText(markdown);

    expect(markdown).toStartWith(`# ${m.coworkingHeroTitle({}, { locale })}`);
    for (const desk of getCoworkingDesks(locale)) {
      expect(markdown).toContain(
        `\n### ${getWorkspaceProductTierTitle(desk.tier, locale)}\n`
      );
      expect(text).toContain(
        plainText(
          m.pricingPerDay(
            {
              price: formatMoney(
                getWorkspaceProductByTier(desk.tier).price,
                locale
              ),
            },
            { locale }
          )
        )
      );
      for (const point of desk.points) expect(text).toContain(point);
    }
    expect(text).not.toContain(saleLine(locale, "open-space"));
  });

  test("shows a running sale beside each desk", () => {
    const text = markdownPlainText(render(locale, 5_000));

    expect(text).toContain(saleLine(locale, "open-space"));
    expect(text).toContain(saleLine(locale, "reserved-desk"));
  });

  test("links each desk's booking with its tier and other pages without a locale", () => {
    const urls = markdownLinkUrls(render(locale));

    expect(urls).toContain(
      "https://workspace.deskohub.cz/reservation/cowork?entryTier=open-space"
    );
    expect(urls).toContain(
      "https://workspace.deskohub.cz/reservation/cowork?entryTier=reserved-desk"
    );
    for (const url of urls) {
      expect(url).toStartWith("https://workspace.deskohub.cz/");
      expect(new URL(url).pathname).not.toMatch(/^\/(en-US|cs-CZ)(\/|$)/);
    }
  });
});
