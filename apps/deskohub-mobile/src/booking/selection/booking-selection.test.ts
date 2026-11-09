import { describe, expect, test } from "bun:test";
import {
  isDateSelectable,
  reservationKindOf,
  selectionKey,
} from "./booking-selection";

describe("selectionKey", () => {
  test("is the same however the selection's fields were ordered", () => {
    expect(
      selectionKey({
        coffee: true,
        tier: "open-space",
        date: "2026-11-07",
        family: "cowork",
      })
    ).toBe(
      selectionKey({
        family: "cowork",
        date: "2026-11-07",
        tier: "open-space",
        coffee: true,
      })
    );
  });

  test("tells apart selections that differ in any field", () => {
    const office = {
      family: "office",
      date: "2026-11-07",
      endDate: "2026-11-09",
      seats: 2,
    } as const;
    const keys = new Set([
      selectionKey(office),
      selectionKey({ ...office, seats: 3 }),
      selectionKey({ ...office, endDate: "2026-11-10" }),
      selectionKey({ ...office, family: "cowork" }),
      selectionKey({
        family: "cowork",
        date: "2026-11-07",
        tier: "open-space",
        coffee: false,
      }),
      selectionKey({
        family: "cowork",
        date: "2026-11-07",
        tier: "open-space",
      }),
    ]);

    expect(keys.size).toBe(6);
  });

  test("lists the family first and then each field set", () => {
    expect(
      selectionKey({
        family: "meeting-room",
        date: "2026-11-07",
        duration: "hour:1",
        startTime: "09:00",
      })
    ).toBe("meeting-room&date=2026-11-07&startTime=09:00&duration=hour:1");
  });
});

describe("reservationKindOf", () => {
  test("maps API families to analytics reservation kinds", () => {
    expect(reservationKindOf("cowork")).toBe("cowork");
    expect(reservationKindOf("meeting-room")).toBe("meeting_room");
    expect(reservationKindOf("office")).toBe("office");
  });
});

describe("isDateSelectable", () => {
  const choice = {
    earliest: "2026-11-07",
    latest: "2026-12-07",
    unavailable: new Set(["2026-11-10"]),
  };

  test("offers dates within the range that aren't unavailable", () => {
    expect(isDateSelectable(choice, "2026-11-07")).toBe(true);
    expect(isDateSelectable(choice, "2026-12-07")).toBe(true);
    expect(isDateSelectable(choice, "2026-11-10")).toBe(false);
    expect(isDateSelectable(choice, "2026-11-06")).toBe(false);
    expect(isDateSelectable(choice, "2026-12-08")).toBe(false);
  });
});
