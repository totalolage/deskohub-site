import { describe, expect, test } from "bun:test";
import {
  getAdministrationReservationHeldRangeBounds,
  getEarlySetupOrderCandidates,
  getReservationDate,
  isAdministrationDateInRange,
  isHeldFromPreviousDateWithEarlySetup,
  sortByBookedStart,
} from "./reservation-booked-date";

// Prague is UTC+2 in August.
const held = (startDate: string, endDate: string) => ({
  startDate,
  endDate,
  seats: "1",
});
const earlySetup = { kind: "meeting-room", earlySetup: true } as const;

describe("administration booked dates", () => {
  test("dates a midnight early-setup booking on its booked date", () => {
    const midnight = held("2026-08-09T21:45:00Z", "2026-08-10T22:00:00Z");

    expect(isHeldFromPreviousDateWithEarlySetup(midnight)).toBe(true);
    expect(getReservationDate(midnight, earlySetup)).toBe("2026-08-10");
    expect(getReservationDate(midnight, { kind: "meeting-room" })).toBe(
      "2026-08-09"
    );
    expect(getReservationDate(midnight)).toBe("2026-08-09");
  });

  test("needs no stored details when setup stays on the booked date", () => {
    const morning = held("2026-08-10T07:45:00Z", "2026-08-10T09:00:00Z");

    expect(isHeldFromPreviousDateWithEarlySetup(morning)).toBe(false);
    expect(getReservationDate(morning, earlySetup)).toBe("2026-08-10");
    expect(getReservationDate(morning)).toBe("2026-08-10");
  });

  test("starts the Dotypos read early enough for early setup", () => {
    expect(
      getAdministrationReservationHeldRangeBounds({
        from: "2026-08-10",
        to: "2026-08-10",
      })
    ).toEqual({
      startsAtOrAfter: "2026-08-09T21:45:00Z",
      startsBefore: "2026-08-10T22:00:00Z",
    });
    expect(
      getAdministrationReservationHeldRangeBounds({ to: "2026-08-10" })
    ).toEqual({ startsBefore: "2026-08-10T22:00:00Z" });
  });

  test("keeps dates in an inclusive, possibly open range", () => {
    const range = { from: "2026-08-10", to: "2026-08-12" };
    expect(isAdministrationDateInRange("2026-08-09", range)).toBe(false);
    expect(isAdministrationDateInRange("2026-08-10", range)).toBe(true);
    expect(isAdministrationDateInRange("2026-08-12", range)).toBe(true);
    expect(isAdministrationDateInRange("2026-08-13", range)).toBe(false);
    expect(
      isAdministrationDateInRange("2026-08-13", { from: "2026-08-10" })
    ).toBe(true);
  });

  test("orders bookings by booked start, keeping ties in order", () => {
    const booking = (id: string, startDate: string) => ({
      ...held(startDate, "2026-08-10T12:00:00Z"),
      id,
    });
    // Dotypos start order: the early-setup room is held from 23:45 for a
    // midnight booking.
    const bookings = [
      booking("setup", "2026-08-09T21:45:00Z"),
      booking("unflagged", "2026-08-09T21:45:00Z"),
      booking("on-time", "2026-08-09T21:50:00Z"),
      booking("midnight", "2026-08-09T22:00:00Z"),
      booking("later", "2026-08-10T08:00:00Z"),
    ];

    expect(getEarlySetupOrderCandidates(bookings).map(({ id }) => id)).toEqual([
      "setup",
      "unflagged",
      "on-time",
      "midnight",
    ]);
    expect(
      sortByBookedStart(bookings, new Map([["setup", earlySetup]])).map(
        ({ id }) => id
      )
    ).toEqual(["unflagged", "on-time", "setup", "midnight", "later"]);
    expect(sortByBookedStart(bookings, new Map())).toEqual(bookings);
  });

  test("reads both neighbours' details when two early-setup bookings start close together", () => {
    const booking = (id: string, startDate: string) => ({
      ...held(startDate, "2026-08-10T12:00:00Z"),
      id,
    });
    const bookings = [
      booking("first-setup", "2026-08-10T07:45:00Z"),
      booking("second-setup", "2026-08-10T07:50:00Z"),
      booking("later", "2026-08-10T09:00:00Z"),
    ];
    const candidates = getEarlySetupOrderCandidates(bookings);

    expect(candidates.map(({ id }) => id)).toEqual([
      "first-setup",
      "second-setup",
    ]);
    expect(
      sortByBookedStart(
        bookings,
        new Map(candidates.map(({ id }) => [id, earlySetup] as const))
      ).map(({ id }) => id)
    ).toEqual(["first-setup", "second-setup", "later"]);
  });
});
