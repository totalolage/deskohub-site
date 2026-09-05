import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import { reservationOrderSchema } from "./reservation-order";

const safeParseReservationOrder = Schema.decodeUnknownResult(
  reservationOrderSchema
);

const validMeetingRoomReservation = {
  kind: "meeting-room",
  duration: { unit: "hour", amount: 1 },
  reservationDate: "2099-06-10",
  startsAt: "2099-06-10T07:00:00Z",
  endsAt: "2099-06-10T08:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
  message: "",
} as const;

describe("reservation schema", () => {
  test("rejects a meeting-room order without an interval", () => {
    const result = safeParseReservationOrder({
      kind: "meeting-room",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  test("discriminates meeting-room orders independently from cowork tiers", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    const result = safeParseReservationOrder(validMeetingRoomReservation);

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({ kind: "meeting-room" });
      expect(result.success).not.toHaveProperty("_tag");
      expect(result.success).not.toHaveProperty("entryTier");
    }
  });

  test("rejects meeting-room as a cowork entry tier", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    expect(
      Result.isFailure(
        safeParseReservationOrder({
          ...validMeetingRoomReservation,
          kind: "cowork",
          entryTier: "meeting-room",
        })
      )
    ).toBe(true);
  });

  test("discriminates cowork orders before refining their tier", () => {
    const result = safeParseReservationOrder({
      kind: "cowork",
      entryTier: "basic",
      date: "2099-06-10",
      coffee: false,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        kind: "cowork",
        entryTier: "basic",
      });
    }
  });

  test("rejects missing and unknown reservation kinds", () => {
    const { kind: _kind, ...withoutKind } = validMeetingRoomReservation;

    expect(Result.isFailure(safeParseReservationOrder(withoutKind))).toBe(true);
    expect(
      Result.isFailure(
        safeParseReservationOrder({
          ...validMeetingRoomReservation,
          kind: "event-space",
        })
      )
    ).toBe(true);
  });

  afterEach(() => {
    setSystemTime();
  });

  test("rejects meeting room reservations whose end has passed", () => {
    setSystemTime(new Date("2099-06-10T08:01:00.000Z"));

    const result = safeParseReservationOrder(validMeetingRoomReservation);

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["endsAt"]');
    }
  });

  test("accepts meeting room reservations that have started but not ended", () => {
    setSystemTime(new Date("2099-06-10T07:30:00.000Z"));

    expect(
      Result.isSuccess(safeParseReservationOrder(validMeetingRoomReservation))
    ).toBe(true);
  });

  test("normalizes meeting room timestamps without dropping order fields", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    const result = safeParseReservationOrder({
      ...validMeetingRoomReservation,
      startsAt: "2099-06-10T09:00",
      endsAt: "2099-06-10T10:00",
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        ...validMeetingRoomReservation,
        billing: { purpose: "personal", invoice: "none" },
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T08:00:00Z",
      });
    }
  });

  test("drops cowork-only fields from meeting-room orders", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    const result = safeParseReservationOrder({
      ...validMeetingRoomReservation,
      coffee: true,
      monitorOption: "2x27-qhd",
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).not.toHaveProperty("coffee");
      expect(result.success).not.toHaveProperty("monitorOption");
    }
  });
});
