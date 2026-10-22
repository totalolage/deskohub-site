import { describe, expect, test } from "bun:test";
import { getPublicOpeningHours } from "@/features/checkout/public-offerings";
import {
  advertisedCatalogOfferings,
  catalogPriceLines,
} from "@/features/checkout/public-offerings.test-utils";
import { type Locale, locales, m } from "@/features/i18n";
import { officeReservationMaximumDurationHours } from "@/features/reservation/office-reservation";
import { serializeMarkdown } from "@/shared/markdown/markdown";
import {
  markdownLinkUrls,
  markdownPlainText,
} from "@/shared/markdown/markdown.test-utils";
import { officeReservationPageMarkdown } from "./office-reservation-page-markdown";

const discountValue = 5_000;

const render = (locale: Locale, { discount = 0, officeOpen = true } = {}) =>
  serializeMarkdown(
    officeReservationPageMarkdown(
      locale,
      advertisedCatalogOfferings({
        discountValue: discount,
        locale,
        ...(officeOpen && { office: {} }),
      })
    )
  );

/**
 * The facts the office reservation page shows. The day and seat price
 * labels are checked with the prices. Left out: form controls and their
 * labels (`reservationOfficeDateRangeLabel`, `reservationOfficeStartDateLabel`,
 * `reservationDatePlaceholder`, `reservationOfficeDayCountLabel`,
 * `reservationOfficeSeatCountLabel`), the form's accessible name
 * (`reservationOfficeFormTitle`, used as the booking link), availability
 * and validation states, the shared customer, billing, and consent fields,
 * and the checkout step navigation.
 */
const pageFacts = (locale: Locale) => [
  m.reservationOfficeMetadataTitle({}, { locale }),
  m.reservationOfficeMetadataDescription({}, { locale }),
  m.reservationOfficeProductTitle({}, { locale }),
  m.publicOfferingOfficeDescription({}, { locale }),
  m.publicOfferingOfficeUsage(
    { hours: officeReservationMaximumDurationHours },
    { locale }
  ),
  m.reservationOfficeFormTitle({}, { locale }),
];

describe.each(locales)("officeReservationPageMarkdown in %s", (locale) => {
  test("states every fact the page shows and the opening hours", () => {
    const text = markdownPlainText(render(locale));

    for (const fact of [...pageFacts(locale), getPublicOpeningHours(locale)]) {
      expect(text).toContain(fact);
    }
  });

  test("prices office access and seats from the catalog", () => {
    const lines = markdownPlainText(render(locale)).split("\n");

    for (const line of catalogPriceLines(locale).office) {
      expect(lines).toContain(line);
    }
  });

  test("shows a public sale on one day with one seat", () => {
    const lines = markdownPlainText(
      render(locale, { discount: discountValue })
    ).split("\n");

    for (const line of catalogPriceLines(locale, { discountValue }).office) {
      expect(lines).toContain(line);
    }
  });

  test("lists only the office", () => {
    const lines = markdownPlainText(render(locale)).split("\n");
    const { cowork, meetingRoom } = catalogPriceLines(locale);

    for (const line of [...cowork, ...meetingRoom]) {
      expect(lines).not.toContain(line);
    }
  });

  test("keeps the booking link but no office while reservations are closed", () => {
    const markdown = render(locale, { officeOpen: false });
    const lines = markdownPlainText(markdown).split("\n");

    for (const line of catalogPriceLines(locale).office) {
      expect(lines).not.toContain(line);
    }
    expect(markdownLinkUrls(markdown)).toEqual([
      "https://workspace.deskohub.cz/reservation/office",
    ]);
  });

  test("links to the office reservation page", () => {
    expect(markdownLinkUrls(render(locale))).toEqual([
      "https://workspace.deskohub.cz/reservation/office",
    ]);
  });
});
