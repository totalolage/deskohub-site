import { expect, test } from "bun:test";
import { matchesExpectedReservationDetails } from "./reservation-details";

test("accepts meeting-room and office snapshots carrying optional product identity", () => {
  expect(
    matchesExpectedReservationDetails(
      { kind: "meeting-room", duration: { unit: "day", amount: 1 } },
      { kind: "meeting-room" }
    )
  ).toBe(true);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office", seats: 4, dayCount: 2 },
      { kind: "office" }
    )
  ).toBe(true);
  expect(
    matchesExpectedReservationDetails({ kind: "office" }, { kind: "office" })
  ).toBe(true);
});

test("accepts snapshots carrying the identity each checkout flow expects", () => {
  expect(
    matchesExpectedReservationDetails(
      { kind: "meeting-room", duration: { unit: "hour", amount: 4 } },
      { kind: "meeting-room", duration: { unit: "hour", amount: 4 } }
    )
  ).toBe(true);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office", seats: 4, dayCount: 2 },
      { kind: "office", seats: 4, dayCount: 2 }
    )
  ).toBe(true);
});

test("rejects snapshots that contradict the expected identity", () => {
  expect(
    matchesExpectedReservationDetails(
      { kind: "meeting-room", duration: { unit: "day", amount: 1 } },
      { kind: "meeting-room", duration: { unit: "hour", amount: 4 } }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "meeting-room" },
      { kind: "meeting-room", duration: { unit: "day", amount: 1 } }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office", seats: 3, dayCount: 2 },
      { kind: "office", seats: 4, dayCount: 2 }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office", seats: 4, dayCount: 1 },
      { kind: "office", seats: 4, dayCount: 2 }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office" },
      { kind: "office", seats: 4, dayCount: 2 }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office" },
      { kind: "meeting-room" }
    )
  ).toBe(false);
});

test("rejects snapshots the family schema does not accept", () => {
  expect(
    matchesExpectedReservationDetails(
      { kind: "meeting-room", roomName: "Blue" },
      { kind: "meeting-room" }
    )
  ).toBe(false);
  expect(
    matchesExpectedReservationDetails(
      { kind: "office", seats: "four" },
      { kind: "office" }
    )
  ).toBe(false);
});

test("requires cowork details to match exactly", () => {
  expect(
    matchesExpectedReservationDetails(
      { kind: "cowork", entryTier: "reserved-desk", coffee: true },
      { kind: "cowork", entryTier: "reserved-desk", coffee: true }
    )
  ).toBe(true);
  expect(
    matchesExpectedReservationDetails(
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      { kind: "cowork", entryTier: "reserved-desk", coffee: true }
    )
  ).toBe(false);
});
