import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { getReservationAccessCodeWindowState } from "./reservation-access-code";

const getState = (now: string) =>
  getReservationAccessCodeWindowState({
    reservedFrom: Temporal.Instant.from("2026-06-20T08:00:00Z"),
    reservedUntil: Temporal.Instant.from("2026-06-20T12:00:00Z"),
    now: Temporal.Instant.from(now),
  });

describe("getReservationAccessCodeWindowState", () => {
  test("uses an inclusive opening and exclusive closing boundary", () => {
    expect(getState("2026-06-20T07:29:59.999999999Z").state).toBe(
      "before-window"
    );
    expect(getState("2026-06-20T07:30:00Z").state).toBe("open");
    expect(getState("2026-06-20T12:29:59.999999999Z").state).toBe("open");
    expect(getState("2026-06-20T12:30:00Z").state).toBe("after-window");
  });

  test("adds elapsed grace time around a Prague spring DST day", () => {
    const state = getReservationAccessCodeWindowState({
      reservedFrom: Temporal.Instant.from("2027-03-27T23:00:00Z"),
      reservedUntil: Temporal.Instant.from("2027-03-28T22:00:00Z"),
      now: Temporal.Instant.from("2027-03-28T08:00:00Z"),
    });

    expect(state).toMatchObject({ state: "open" });
    expect(state.opensAt.toString()).toBe("2027-03-27T22:30:00Z");
    expect(state.closesAt.toString()).toBe("2027-03-28T22:30:00Z");
  });

  test("adds elapsed grace time around a Prague autumn DST day", () => {
    const state = getReservationAccessCodeWindowState({
      reservedFrom: Temporal.Instant.from("2026-10-24T22:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-10-25T23:00:00Z"),
      now: Temporal.Instant.from("2026-10-25T08:00:00Z"),
    });

    expect(state).toMatchObject({ state: "open" });
    expect(state.opensAt.toString()).toBe("2026-10-24T21:30:00Z");
    expect(state.closesAt.toString()).toBe("2026-10-25T23:30:00Z");
  });
});
