import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Result } from "effect";
import "@/shared/polyfills/temporal";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import { reservationOrderEffectSchema } from "./reservation-order";

const reservationOrderSchema = makeEffectSchemaParser(
  reservationOrderEffectSchema
);

const validMeetingRoomReservation = {
  entryTier: "meeting-room",
  startsAt: "2099-06-10T07:00:00Z",
  endsAt: "2099-06-10T08:00:00Z",
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420777777777",
  message: "",
} as const;

describe("reservation schema", () => {
  test("rejects a meeting-room order without an interval", () => {
    const result = reservationOrderSchema.safeParse({
      entryTier: "meeting-room",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
    });

    expect(Result.isFailure(result)).toBe(true);
  });

  afterEach(() => {
    setSystemTime();
  });

  test("rejects meeting room reservations whose end has passed", () => {
    setSystemTime(new Date("2099-06-10T08:01:00.000Z"));

    const result = reservationOrderSchema.safeParse(
      validMeetingRoomReservation
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["endsAt"]');
    }
  });

  test("accepts meeting room reservations that have started but not ended", () => {
    setSystemTime(new Date("2099-06-10T07:30:00.000Z"));

    expect(
      Result.isSuccess(
        reservationOrderSchema.safeParse(validMeetingRoomReservation)
      )
    ).toBe(true);
  });

  test("normalizes meeting room timestamps without dropping order fields", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    const result = reservationOrderSchema.safeParse({
      ...validMeetingRoomReservation,
      startsAt: "2099-06-10T09:00",
      endsAt: "2099-06-10T10:00",
    });

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toEqual({
        ...validMeetingRoomReservation,
        startsAt: "2099-06-10T07:00:00Z",
        endsAt: "2099-06-10T08:00:00Z",
      });
    }
  });

  test("drops cowork-only fields from meeting-room orders", () => {
    setSystemTime(new Date("2099-06-10T06:00:00.000Z"));

    const result = reservationOrderSchema.safeParse({
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
