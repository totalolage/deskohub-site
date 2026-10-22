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
import { meetingRoomReservationPageMarkdown } from "./meeting-room-reservation-page-markdown";

const discountValue = 5_000;

const render = (locale: Locale, discount = 0) =>
  serializeMarkdown(
    meetingRoomReservationPageMarkdown(
      locale,
      advertisedCatalogOfferings({
        discountValue: discount,
        locale,
        office: {},
      })
    )
  );

/**
 * The facts the meeting-room reservation page shows. Duration labels are
 * checked with the prices. Left out: form controls and their labels
 * (`reservationMeetingRoomStartLabel`, `reservationMeetingRoomDateLabel`,
 * `reservationMeetingRoomTimeLabel`, `reservationDateLabel`,
 * `reservationDatePlaceholder`, `reservationMeetingRoomDurationLabel`), the
 * form's accessible name (`reservationMeetingRoomFormTitle`), start-time,
 * availability, loading, and validation states, the shared customer,
 * billing, and consent fields, and the checkout step navigation.
 */
const pageFacts = (locale: Locale) => [
  m.reservationMeetingRoomMetadataTitle({}, { locale }),
  m.reservationMeetingRoomMetadataDescription({}, { locale }),
  m.reservationTierMeetingRoomTitle({}, { locale }),
  m.reservationTierMeetingRoomDescription({}, { locale }),
  m.publicOfferingMeetingRoomUsage({}, { locale }),
  m.meetingRoomReservationCta({}, { locale }),
];

describe.each(locales)("meetingRoomReservationPageMarkdown in %s", (locale) => {
  test("states every fact the page shows and the opening hours", () => {
    const text = markdownPlainText(render(locale));

    for (const fact of [...pageFacts(locale), getPublicOpeningHours(locale)]) {
      expect(text).toContain(fact);
    }
  });

  test("prices each duration from the catalog", () => {
    const lines = markdownPlainText(render(locale)).split("\n");

    for (const line of catalogPriceLines(locale).meetingRoom) {
      expect(lines).toContain(line);
    }
  });

  test("shows a public sale on each advertised booking", () => {
    const lines = markdownPlainText(render(locale, discountValue)).split("\n");

    for (const line of catalogPriceLines(locale, { discountValue })
      .meetingRoom) {
      expect(lines).toContain(line);
    }
  });

  test("lists only meeting-room bookings", () => {
    const lines = markdownPlainText(render(locale)).split("\n");
    const { cowork, office } = catalogPriceLines(locale);

    for (const line of [...cowork, ...office]) {
      expect(lines).not.toContain(line);
    }
  });

  test("links to the meeting-room reservation page", () => {
    expect(markdownLinkUrls(render(locale))).toEqual([
      "https://workspace.deskohub.cz/reservation/meeting-room",
    ]);
  });
});
