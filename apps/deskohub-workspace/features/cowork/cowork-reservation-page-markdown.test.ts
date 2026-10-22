import { describe, expect, test } from "bun:test";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import {
  advertisedCatalogOfferings,
  catalogPriceLines,
} from "@/features/checkout/public-offerings.test-utils";
import { type Locale, locales, m } from "@/features/i18n";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { coworkReservationPageMarkdown } from "./cowork-reservation-page-markdown";

const discountValue = 5_000;

const render = (locale: Locale, discount = 0) =>
  serializeMarkdown(
    coworkReservationPageMarkdown(
      locale,
      advertisedCatalogOfferings({
        discountValue: discount,
        locale,
        office: {},
      })
    )
  );

/**
 * The facts the cowork reservation page shows. Left out: form controls and
 * their labels (`reservationTierLabel`, `reservationDateLabel`,
 * `reservationDatePlaceholder`, `reservationMonitorLabel`), the form's
 * accessible name (`reservationFormTitle`), availability, loading, and
 * validation states, the workstation-required tooltip, the replaced-offer
 * notice for restored reservations, the shared customer, billing, and
 * consent fields, and the checkout step navigation.
 */
const pageFacts = (locale: Locale) => [
  m.checkoutOrderMetadataTitle({}, { locale }),
  m.checkoutOrderMetadataDescription({}, { locale }),
  m.reservationOpenSpaceTitle({}, { locale }),
  m.reservationOpenSpaceDescription(
    { until: workspaceSiteConstants.openingHours.openSpaceUsableUntil },
    { locale }
  ),
  m.reservationOpenSpaceBulletDesk(
    { until: workspaceSiteConstants.openingHours.openSpaceUsableUntil },
    { locale }
  ),
  m.reservationOpenSpacePerkWifi({}, { locale }),
  m.publicOfferingOpenSpaceUsage(
    { until: workspaceSiteConstants.openingHours.openSpaceUsableUntil },
    { locale }
  ),
  m.reservationReservedDeskTitle({}, { locale }),
  m.reservationReservedDeskDescription({}, { locale }),
  m.reservationReservedDeskBulletDesk({}, { locale }),
  m.reservationReservedDeskPerkAccess({}, { locale }),
  m.reservationReservedDeskPerkCoffee({}, { locale }),
  m.reservationReservedDeskPerkMonitor({}, { locale }),
  m.publicOfferingReservedDeskUsage({}, { locale }),
  ...(workspaceSiteConstants.openingHours.alwaysOpen
    ? [m.publicOfferingReservedDeskAlwaysOpenAccess({}, { locale })]
    : []),
  m.reservationTierPerksLabel({}, { locale }),
  m.reservationCoffeeLabel({}, { locale }),
  m.reservationWorkstationLabel({}, { locale }),
  m.reservationMonitor2x27QhdDescription({}, { locale }),
  m.reservationMonitor2x32QhdDescription({}, { locale }),
  m.reservationMonitor2x27FourKDescription({}, { locale }),
  m.reservationMonitor2x32FourKDescription({}, { locale }),
  m.landingHeroPrimaryCta({}, { locale }),
];

describe.each(locales)("coworkReservationPageMarkdown in %s", (locale) => {
  test("states every fact the page shows and the opening hours", () => {
    const text = markdownPlainText(render(locale));

    for (const fact of [...pageFacts(locale), getPublicOpeningHours(locale)]) {
      expect(text).toContain(fact);
    }
  });

  test("prices each cowork offer from the catalog", () => {
    const lines = markdownPlainText(render(locale)).split("\n");

    for (const line of catalogPriceLines(locale).cowork) {
      expect(lines).toContain(line);
    }
  });

  test("shows a public sale on the advertised day", () => {
    const lines = markdownPlainText(render(locale, discountValue)).split("\n");

    for (const line of catalogPriceLines(locale, { discountValue }).cowork) {
      expect(lines).toContain(line);
    }
  });

  test("lists only cowork offers", () => {
    const lines = markdownPlainText(render(locale)).split("\n");
    const { meetingRoom, office } = catalogPriceLines(locale);

    for (const line of [...meetingRoom, ...office]) {
      expect(lines).not.toContain(line);
    }
  });

  test("links to the cowork reservation page", () => {
    expect(markdownLinkUrls(render(locale))).toEqual([
      "https://workspace.deskohub.cz/reservation/cowork",
    ]);
  });
});
