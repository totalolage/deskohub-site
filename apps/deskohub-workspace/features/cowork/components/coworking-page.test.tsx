import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { WorkspaceCoworkCurrentTier } from "@/features/checkout/product-catalog";
import {
  getPublicCatalogOfferings,
  type PublicPriceListOffering,
} from "@/features/checkout/public-offerings";
import { type Locale, locales } from "@/features/i18n";
import { currencyCZK } from "@/shared/money/currencies";
import { formatMoney } from "@/shared/money/money";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { CoworkingPage } from "./coworking-page";

beforeAll(registerWorkspaceComponentTestEnv);
afterAll(unregisterWorkspaceComponentTestEnv);

const catalogOffering = (
  locale: Locale,
  tier: WorkspaceCoworkCurrentTier
): PublicPriceListOffering => {
  const offering = getPublicCatalogOfferings({ locale }).find(
    (candidate) => candidate.kind === "cowork" && candidate.tier === tier
  );
  if (!offering) throw new Error(`The catalog lists no ${tier} offering.`);
  return offering;
};

const meetingRoomOfferings = (locale: Locale) =>
  getPublicCatalogOfferings({ locale }).filter(
    (offering) => offering.kind === "meeting-room"
  );

/** Each desk card's visible text, keyed by tier. */
const renderDeskCards = (
  locale: Locale,
  offerings: ReadonlyArray<PublicPriceListOffering>
) => {
  const document = new DOMParser().parseFromString(
    renderToString(
      <CoworkingPage locale={locale} offerings={offerings} photos={[]} />
    ),
    "text/html"
  );
  return Object.fromEntries(
    [...document.querySelectorAll("article[aria-labelledby]")].map(
      (article) => [
        article.getAttribute("aria-labelledby"),
        article.textContent ?? "",
      ]
    )
  );
};

describe("CoworkingPage desk cards", () => {
  for (const locale of locales) {
    test(`shows each desk's own day price and only a running sale's regular price in ${locale}`, () => {
      const openSpace = catalogOffering(locale, "open-space");
      const reservedDesk = catalogOffering(locale, "reserved-desk");
      const cards = renderDeskCards(locale, [
        ...meetingRoomOfferings(locale),
        {
          ...openSpace,
          advertisedPrice: {
            price: currencyCZK(23_200),
            discount: currencyCZK(5800),
          },
        },
        reservedDesk,
      ]);
      const openSpaceCard = cards["coworking-desk-open-space"];
      const reservedDeskCard = cards["coworking-desk-reserved-desk"];

      expect(Object.keys(cards)).toEqual([
        "coworking-desk-open-space",
        "coworking-desk-reserved-desk",
      ]);
      expect(openSpaceCard).toContain(formatMoney(openSpace.price, locale));
      expect(openSpaceCard).toContain(formatMoney(currencyCZK(23_200), locale));
      expect(openSpaceCard).toContain(formatMoney(currencyCZK(29_000), locale));
      expect(reservedDeskCard).toContain(
        formatMoney(reservedDesk.price, locale)
      );
      expect(reservedDeskCard).not.toContain(
        formatMoney(currencyCZK(23_200), locale)
      );
    });
  }

  test("leaves out the price of a desk with no cowork offering", () => {
    const locale = "en-US";
    const reservedDesk = catalogOffering(locale, "reserved-desk");
    const cards = renderDeskCards(locale, meetingRoomOfferings(locale));

    expect(cards["coworking-desk-reserved-desk"]).toBeDefined();
    expect(cards["coworking-desk-reserved-desk"]).not.toContain(
      formatMoney(reservedDesk.price, locale)
    );
  });
});
