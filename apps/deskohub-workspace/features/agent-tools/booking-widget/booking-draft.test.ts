import { describe, expect, test } from "bun:test";
import {
  type BookingDraft,
  getBookingLocale,
  getInitialDraft,
  validateBookingDraft,
  withRequiredWorkstation,
} from "./booking-draft";
import {
  availabilityResult,
  bookingStart,
  bookingToday,
} from "./booking-widget.test-utils";

const start = bookingStart({ mode: "reserve", locale: "en-US" });

const draft = (change: Partial<BookingDraft> = {}): BookingDraft => ({
  ...getInitialDraft(start),
  ...change,
});

describe("getBookingLocale", () => {
  test("prefers the agent's locale, then a Czech host, then English", () => {
    expect(getBookingLocale({ requested: "en-US", hostLocale: "cs-CZ" })).toBe(
      "en-US"
    );
    expect(getBookingLocale({ hostLocale: "cs" })).toBe("cs-CZ");
    expect(getBookingLocale({ hostLocale: "CS-cz" })).toBe("cs-CZ");
    expect(getBookingLocale({ hostLocale: "de-DE" })).toBe("en-US");
    expect(getBookingLocale({})).toBe("en-US");
  });
});

describe("getInitialDraft", () => {
  test("opens on the first family and options, today, one day and one seat", () => {
    expect(getInitialDraft(start)).toEqual({
      family: "cowork",
      tier: "open-space",
      duration: "hour:1",
      date: bookingToday,
      startTime: "",
      dayCount: "1",
      seats: "1",
    });
  });

  test("takes the agent's prefill, counting an office range in days", () => {
    expect(
      getInitialDraft(
        bookingStart({
          mode: "reserve",
          locale: "en-US",
          selection: {
            family: "office",
            date: "2099-08-03",
            end_date: "2099-08-05",
            seats: 3,
          },
        })
      )
    ).toMatchObject({
      family: "office",
      date: "2099-08-03",
      dayCount: "3",
      seats: "3",
    });
  });

  test("ignores a prefilled family the offerings don't include", () => {
    expect(
      getInitialDraft({
        ...start,
        offerings: start.offerings.filter(({ family }) => family !== "office"),
        selection: { family: "office" },
      }).family
    ).toBe("cowork");
  });
});

describe("validateBookingDraft", () => {
  test("builds the cowork arguments for one date and tier", () => {
    expect(
      validateBookingDraft(draft({ tier: "reserved-desk" }), start)
    ).toEqual({
      valid: true,
      selection: {
        family: "cowork",
        date: bookingToday,
        tier: "reserved-desk",
      },
    });
  });

  test("rejects a missing or past date", () => {
    expect(validateBookingDraft(draft({ date: "" }), start)).toEqual({
      valid: false,
      errors: [{ field: "date", reason: "required" }],
    });
    expect(validateBookingDraft(draft({ date: "2099-07-27" }), start)).toEqual({
      valid: false,
      errors: [{ field: "date", reason: "passed" }],
    });
  });

  test("asks an hourly meeting room for a start time on the hour", () => {
    const meetingRoom = { family: "meeting-room", duration: "hour:4" } as const;

    expect(validateBookingDraft(draft(meetingRoom), start)).toEqual({
      valid: false,
      errors: [{ field: "startTime", reason: "required" }],
    });
    expect(
      validateBookingDraft(draft({ ...meetingRoom, startTime: "09:30" }), start)
    ).toEqual({
      valid: false,
      errors: [{ field: "startTime", reason: "whole-hour" }],
    });
    expect(
      validateBookingDraft(draft({ ...meetingRoom, startTime: "09:00" }), start)
    ).toEqual({
      valid: true,
      selection: {
        family: "meeting-room",
        date: bookingToday,
        duration: "hour:4",
        start_time: "09:00",
      },
    });
  });

  test("books a whole meeting-room day without a start time", () => {
    expect(
      validateBookingDraft(
        draft({
          family: "meeting-room",
          duration: "day:1",
          startTime: "09:30",
        }),
        start
      )
    ).toEqual({
      valid: true,
      selection: {
        family: "meeting-room",
        date: bookingToday,
        duration: "day:1",
      },
    });
  });

  test("turns office days into an end date and keeps days and seats within the office limits", () => {
    const office = { family: "office" } as const;

    expect(
      validateBookingDraft(
        draft({ ...office, dayCount: "3", seats: "2" }),
        start
      )
    ).toEqual({
      valid: true,
      selection: {
        family: "office",
        date: bookingToday,
        end_date: "2099-07-30",
        seats: 2,
      },
    });
    expect(
      validateBookingDraft(
        draft({ ...office, dayCount: "1", seats: "1" }),
        start
      )
    ).toEqual({
      valid: true,
      selection: { family: "office", date: bookingToday, seats: 1 },
    });
    expect(
      validateBookingDraft(
        draft({ ...office, dayCount: "29", seats: "7" }),
        start
      )
    ).toEqual({
      valid: false,
      errors: [
        { field: "dayCount", max: 28 },
        { field: "seats", max: 6 },
      ],
    });
    expect(
      validateBookingDraft(
        draft({ ...office, dayCount: "1.5", seats: "" }),
        start
      )
    ).toMatchObject({
      valid: false,
      errors: [{ field: "dayCount" }, { field: "seats" }],
    });
  });
});

describe("withRequiredWorkstation", () => {
  const reservedDesk = {
    family: "cowork",
    date: bookingToday,
    tier: "reserved-desk",
  } as const;

  test("adds the first monitor configuration where only workstation desks are left", () => {
    const availability = availabilityResult(true);
    const required = {
      ...availability,
      days: availability.days.map((day) => ({
        ...day,
        offers: day.offers?.map((offer) => ({
          ...offer,
          workstation_required: offer.tier === "reserved-desk",
        })),
      })),
    };

    expect(
      withRequiredWorkstation(reservedDesk, required, start.offerings)
    ).toEqual({ ...reservedDesk, monitor_option: "2x27-qhd" });
  });

  test("leaves the selection alone otherwise", () => {
    expect(
      withRequiredWorkstation(
        reservedDesk,
        availabilityResult(true),
        start.offerings
      )
    ).toEqual(reservedDesk);
  });
});
