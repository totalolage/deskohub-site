import { describe, expect, test } from "bun:test";
import {
  getAdministrationReservationHeldRangeBounds,
  getReservationDate,
  isAdministrationDateInRange,
  isHeldFromPreviousDateWithEarlySetup,
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
});
