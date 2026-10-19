import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { PublicOffering } from "@/features/checkout/public-offerings";
import { advertisedCatalogOfferings } from "@/features/checkout/public-offerings.test-utils";
import {
  currencyCZK,
  formatWorkspaceMoney,
} from "@/features/checkout/workspace-money";
import { type Locale, locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import { markdownPlainText } from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { pricingPageMarkdown } from "./pricing-page-markdown";

const renderPricingPage = async (
  locale: Locale,
  offerings: ReadonlyArray<PublicOffering>
) =>
  serializeMarkdown(
    await Effect.runPromise(
      pricingPageMarkdown(locale, {
        isPublished: () => true,
        offerings: Effect.succeed(offerings),
        saleBanner: Effect.succeed(undefined),
      })
    )
  );

const headings = (markdown: string, depth: number) =>
  markdown
    .split("\n")
    .filter((line) => line.startsWith(`${"#".repeat(depth)} `))
    .map((line) => line.slice(depth + 1));

describe.each(locales)("pricingPageMarkdown in %s", (locale) => {
  test("lists the opening hours, every price by family, and the address", async () => {
    const markdown = await renderPricingPage(
      locale,
      advertisedCatalogOfferings({ locale, office: {} })
    );
    const text = markdownPlainText(markdown);
    const { address } = workspaceSiteConstants.location;

    expect(markdown).toStartWith(`# ${m.pricingPageTitle({}, { locale })}`);
    expect(headings(markdown, 2)).toEqual([
      m.pricingOpeningHoursTitle({}, { locale }),
      m.pricingCoworkTitle({}, { locale }),
      getWorkspaceMeetingRoomProductTitle(locale),
      getWorkspaceOfficeProductTitle(locale),
      m.contactAddressLabel({}, { locale }),
    ]);
    for (const line of [
      m.pricingOpeningHoursSpace({}, { locale }),
      m.pricingOpeningHoursOpenSpace({ until: "17:00" }, { locale }),
      m.pricingOpeningHoursCodeAccess({}, { locale }),
      `${address.street}, ${address.cityDistrict}, ${address.postalCode} ${address.city}`,
      ...[29_000, 41_000, 35_000, 98_000, 182_000, 53_000, 31_500].map(
        (value) =>
          // Plain text collapses the formatter's no-break spaces.
          formatWorkspaceMoney(currencyCZK(value), locale).replace(/\s+/g, " ")
      ),
    ]) {
      expect(text).toContain(line);
    }
  });

  test("leaves out the office while its page is unpublished", async () => {
    const markdown = await renderPricingPage(
      locale,
      advertisedCatalogOfferings({ locale })
    );

    expect(headings(markdown, 2)).not.toContain(
      getWorkspaceOfficeProductTitle(locale)
    );
  });
});
