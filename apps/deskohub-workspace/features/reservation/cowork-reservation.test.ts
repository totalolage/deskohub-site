import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { makeEffectSchemaParser } from "@/shared/utils/effect-schema-parser";
import { coworkReservationEffectSchema } from "./cowork-reservation";

const coworkReservationSchema = makeEffectSchemaParser(
  coworkReservationEffectSchema
);

describe("cowork reservation schema", () => {
  test("represents cowork reservations by date without an interval", () => {
    const result = coworkReservationSchema.safeParse({
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

  test("rejects monitor setup for non-profi cowork tiers", () => {
    const result = coworkReservationSchema.safeParse({
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
    const result = coworkReservationSchema.safeParse({
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
