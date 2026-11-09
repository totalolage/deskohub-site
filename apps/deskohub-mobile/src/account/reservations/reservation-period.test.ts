import { describe, expect, test } from "bun:test";
import { DateTime } from "effect";
import { formatInstant } from "../../i18n/date-time-format";
import { m } from "../../i18n/messages";
import { reservationPeriodText } from "./reservation-period";

const locales = ["en-US", "cs-CZ"] as const;

// Prague is UTC+1 in winter: 30 November 00:00 there is 29 November 23:00 UTC.
const officeDay = {
  kind: "office",
  startsAt: "2026-11-29T23:00:00Z",
  endsAt: "2026-11-30T23:00:00Z",
} as const;

describe("reservationPeriodText", () => {
  test("shows a one-day office booking as its date, without times", () => {
    expect(reservationPeriodText(officeDay, "en-US")).toBe(
      "Monday, November 30, 2026"
    );
    expect(reservationPeriodText(officeDay, "cs-CZ")).toBe(
      "pondělí 30. listopadu 2026"
    );
  });

  test("shows a multi-day office booking from its first to its last day", () => {
    // 30 November to 4 December inclusive; the end is 5 December 00:00.
    const week = { ...officeDay, endsAt: "2026-12-04T23:00:00Z" };
    expect(reservationPeriodText(week, "en-US")).toBe(
      "Monday, November 30, 2026 – Friday, December 4, 2026"
    );
    expect(reservationPeriodText(week, "cs-CZ")).toBe(
      "pondělí 30. listopadu 2026 – pátek 4. prosince 2026"
    );
  });

  test("counts office days by the Prague calendar across a clock change", () => {
    // 23 to 26 October; summer time ends on 25 October.
    const overClockChange = {
      kind: "office",
      startsAt: "2026-10-22T22:00:00Z",
      endsAt: "2026-10-26T23:00:00Z",
    } as const;
    expect(reservationPeriodText(overClockChange, "en-US")).toBe(
      "Friday, October 23, 2026 – Monday, October 26, 2026"
    );
  });

  test("shows a cowork day as its date, whether it ends at closing or midnight", () => {
    const openSpace = {
      kind: "cowork",
      startsAt: "2026-11-29T23:00:00Z",
      endsAt: "2026-11-30T16:00:00Z",
    } as const;
    const wholeDay = { ...openSpace, endsAt: "2026-11-30T23:00:00Z" };
    for (const day of [openSpace, wholeDay]) {
      expect(reservationPeriodText(day, "en-US")).toBe(
        "Monday, November 30, 2026"
      );
      expect(reservationPeriodText(day, "cs-CZ")).toBe(
        "pondělí 30. listopadu 2026"
      );
    }
  });

  test("keeps a meeting room's start and end times", () => {
    const meeting = {
      kind: "meeting-room",
      startsAt: "2026-11-30T08:00:00Z",
      endsAt: "2026-11-30T10:00:00Z",
    } as const;
    const start = DateTime.makeUnsafe(meeting.startsAt);
    const end = DateTime.makeUnsafe(meeting.endsAt);
    for (const locale of locales) {
      expect(reservationPeriodText(meeting, locale)).toBe(
        m.reservations_time_range(
          {
            start: formatInstant(start, locale, "date-time"),
            end: formatInstant(end, locale, "time"),
          },
          { locale }
        )
      );
    }
    expect(reservationPeriodText(meeting, "en-US")).toContain("9:00");
    expect(reservationPeriodText(meeting, "en-US")).toContain("11:00");
  });

  test("shows a whole-day meeting room as its day, as the site's account page does", () => {
    const wholeDay = { ...officeDay, kind: "meeting-room" } as const;
    expect(reservationPeriodText(wholeDay, "en-US")).toBe(
      "Monday, November 30, 2026"
    );
  });

  test("shows a missing or unreadable time as unavailable", () => {
    for (const locale of locales) {
      const unavailable = m.reservations_value_unavailable({}, { locale });
      expect(
        reservationPeriodText({ ...officeDay, endsAt: undefined }, locale)
      ).toBe(unavailable);
      expect(
        reservationPeriodText({ ...officeDay, startsAt: null }, locale)
      ).toBe(unavailable);
      expect(
        reservationPeriodText({ ...officeDay, endsAt: "soon" }, locale)
      ).toBe(unavailable);
    }
  });
});
