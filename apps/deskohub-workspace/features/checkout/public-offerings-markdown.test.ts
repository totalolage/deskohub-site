import { describe, expect, test } from "bun:test";
import { locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { markdownPlainText } from "@/shared/markdown/markdown.test-utils";
import {
  advertisedCatalogOfferings,
  catalogPriceLines,
} from "./public-offerings.test-utils";
import { publicOfferingsMarkdown } from "./public-offerings-markdown";

const discountValue = 5_000;

const plainLines = (
  offerings: Parameters<typeof publicOfferingsMarkdown>[0],
  locale: (typeof locales)[number]
) =>
  markdownPlainText(
    serializeMarkdown([publicOfferingsMarkdown(offerings, locale)])
  ).split("\n");

describe.each(locales)("publicOfferingsMarkdown in %s", (locale) => {
  test("lists every offering at its catalog price, unit, and add-ons", () => {
    const lines = plainLines(
      advertisedCatalogOfferings({ locale, office: {} }),
      locale
    );
    const expected = catalogPriceLines(locale);

    for (const line of [
      ...expected.cowork,
      ...expected.meetingRoom,
      ...expected.office,
    ]) {
      expect(lines).toContain(line);
    }
  });

  test("states when each offering can be used", () => {
    const offerings = advertisedCatalogOfferings({ locale, office: {} });
    const lines = plainLines(offerings, locale);

    for (const { usage } of offerings) {
      expect(lines).toContain(usage);
    }
  });

  test("shows no sale while nothing is discounted", () => {
    const text = plainLines(
      advertisedCatalogOfferings({ locale, office: {} }),
      locale
    ).join("\n");

    expect(text).not.toContain(
      m.checkoutSummaryOriginalPrice({ price: "" }, { locale }).trim()
    );
  });

  test("shows the sale price beside the price it replaces", () => {
    const lines = plainLines(
      advertisedCatalogOfferings({ discountValue, locale, office: {} }),
      locale
    );
    const expected = catalogPriceLines(locale, { discountValue });

    for (const line of [
      ...expected.cowork,
      ...expected.meetingRoom,
      ...expected.office,
    ]) {
      expect(lines).toContain(line);
    }
  });

  test("leaves out the office while office reservations are closed", () => {
    const lines = plainLines(advertisedCatalogOfferings({ locale }), locale);

    expect(lines).not.toContain(catalogPriceLines(locale).office[0]);
  });
});
