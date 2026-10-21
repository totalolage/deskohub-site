import { describe, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { type Locale, m } from "@/features/i18n";
import {
  type BookingDraft,
  getBookingLocale,
  getInitialDraft,
  makeBookingDraftSchema,
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

/** Validates the draft as the form's resolver does. */
const resolve = (change: Partial<BookingDraft>, locale: Locale = "en-US") =>
  effectSchemaResolver(makeBookingDraftSchema({ ...start, locale }))(
    draft(change),
    undefined,
    { fields: {}, shouldUseNativeValidation: false }
  );

/** Each invalid field's message. */
const messages = async (
  change: Partial<BookingDraft>,
  locale: Locale = "en-US"
) =>
  Object.fromEntries(
    Object.entries((await resolve(change, locale)).errors).map(
      ([field, error]) => [field, error?.message]
    )
  );

describe("makeBookingDraftSchema", () => {
  test("builds the cowork arguments for one date and tier", async () => {
    expect(await resolve({ tier: "reserved-desk" })).toEqual({
      values: { family: "cowork", date: bookingToday, tier: "reserved-desk" },
      errors: {},
    });
  });

  test("rejects a missing or past date", async () => {
    expect(await messages({ date: "" })).toEqual({
      date: m.bookingWidgetDateRequired({}, { locale: "en-US" }),
    });
    expect(await messages({ date: "2099-07-27" }, "cs-CZ")).toEqual({
      date: m.bookingWidgetDatePassed({}, { locale: "cs-CZ" }),
    });
  });

  test("asks an hourly meeting room for a start time on the hour", async () => {
    const meetingRoom = { family: "meeting-room", duration: "hour:4" } as const;

    expect(await messages(meetingRoom)).toEqual({
      startTime: m.bookingWidgetStartTimeRequired({}, { locale: "en-US" }),
    });
    expect(await messages({ ...meetingRoom, startTime: "09:30" })).toEqual({
      startTime: m.reservationValidationMeetingRoomStartWholeHour(
        {},
        { locale: "en-US" }
      ),
    });
    expect(
      (await resolve({ ...meetingRoom, startTime: "09:00" })).values
    ).toEqual({
      family: "meeting-room",
      date: bookingToday,
      duration: "hour:4",
      start_time: "09:00",
    });
  });

  test("books a whole meeting-room day without a start time", async () => {
    expect(
      (
        await resolve({
          family: "meeting-room",
          duration: "day:1",
          startTime: "09:30",
        })
      ).values
    ).toEqual({
      family: "meeting-room",
      date: bookingToday,
      duration: "day:1",
    });
  });

  test("ignores the fields of the families not chosen", async () => {
    expect(
      (await resolve({ startTime: "09:30", dayCount: "", seats: "99" })).errors
    ).toEqual({});
  });

  test("turns office days into an end date and keeps days and seats within the office limits", async () => {
    const office = { family: "office" } as const;

    expect(
      (await resolve({ ...office, dayCount: "3", seats: "2" })).values
    ).toEqual({
      family: "office",
      date: bookingToday,
      end_date: "2099-07-30",
      seats: 2,
    });
    expect(
      (await resolve({ ...office, dayCount: "1", seats: "1" })).values
    ).toEqual({ family: "office", date: bookingToday, seats: 1 });
    expect(
      await messages({ ...office, dayCount: "29", seats: "7" }, "cs-CZ")
    ).toEqual({
      dayCount: m.bookingWidgetDayCountRange({ max: 28 }, { locale: "cs-CZ" }),
      seats: m.bookingWidgetSeatCountRange({ max: 6 }, { locale: "cs-CZ" }),
    });
    expect(await messages({ ...office, dayCount: "1.5", seats: "" })).toEqual({
      dayCount: m.bookingWidgetDayCountRange({ max: 28 }, { locale: "en-US" }),
      seats: m.bookingWidgetSeatCountRange({ max: 6 }, { locale: "en-US" }),
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
