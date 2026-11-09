import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Result, Schema } from "effect";
import "@/shared/polyfills/temporal";
import { testEmailAddress } from "@deskohub/test-email";
import { reservationOrderSchema } from "./reservation-order";

const testEmailAddressForAda = testEmailAddress("ada");

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
  email: testEmailAddressForAda,
  phone: "+420777777777",
} as const;

describe("reservation schema", () => {
  test("discriminates cowork orders before refining their tier", () => {
    const result = safeParseReservationOrder({
      kind: "cowork",
      entryTier: "basic",
      date: "2099-06-10",
      coffee: false,
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
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
});
