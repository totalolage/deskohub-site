import { afterEach, describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import {
  reservationEffectSchema,
  reservationOrderEffectSchema,
} from "./reservation";

const reservationOrderSchema = makeEffectSchemaParser(
  reservationOrderEffectSchema
);
const reservationSchema = makeEffectSchemaParser(reservationEffectSchema);

const originalDateNow = Date.now;

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

    expect(result.success).toBe(false);
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  test("rejects meeting room start times in the past", () => {
    Date.now = () => new Date("2099-06-10T08:00:00.000Z").getTime();

    const result = reservationOrderSchema.safeParse(
      validMeetingRoomReservation
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(String(result.error)).toContain('at ["startsAt"]');
    }
  });

  test("accepts meeting room start times in the future", () => {
    Date.now = () => new Date("2099-06-10T06:00:00.000Z").getTime();

    expect(
      reservationOrderSchema.safeParse(validMeetingRoomReservation).success
    ).toBe(true);
  });

  test("represents cowork reservations by date without an interval", () => {
    const result = reservationSchema.safeParse({
      entryTier: "plus",
      date: "2099-06-10",
      coffee: false,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "  hello  ",
      legalConsent: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        entryTier: "plus",
        date: "2099-06-10",
        coffee: true,
        message: "hello",
      });
      expect(result.data).not.toHaveProperty("startsAt");
      expect(result.data).not.toHaveProperty("endsAt");
    }
  });

  test("drops cowork-only fields from meeting-room orders", () => {
    Date.now = () => new Date("2099-06-10T06:00:00.000Z").getTime();

    const result = reservationOrderSchema.safeParse({
      ...validMeetingRoomReservation,
      coffee: true,
      monitorOption: "2x27-qhd",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("coffee");
      expect(result.data).not.toHaveProperty("monitorOption");
    }
  });

  test("rejects monitor setup for non-profi cowork tiers", () => {
    const result = reservationSchema.safeParse({
      entryTier: "basic",
      date: "2099-06-10",
      startsAt: "00:00",
      endsAt: "24:00",
      coffee: false,
      monitorOption: "2x27-qhd",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(String(result.error)).toContain('at ["monitorOption"]');
    }
  });

  test("requires a monitor setup for profi cowork reservations", () => {
    const result = reservationSchema.safeParse({
      entryTier: "profi",
      date: "2099-06-10",
      startsAt: "00:00",
      endsAt: "24:00",
      coffee: true,
      monitorOption: undefined,
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
      message: "",
      legalConsent: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(String(result.error)).toContain('at ["monitorOption"]');
    }
  });
});
