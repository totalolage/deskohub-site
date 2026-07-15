import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import "@/shared/polyfills/temporal";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  coworkReservationSchema,
  getCoworkReservationIntervalInput,
} from "./cowork-reservation";

const coworkReservationParser = makeSchemaParser(coworkReservationSchema);

describe("cowork reservation schema", () => {
  test("owns the cowork full-day interval policy", () => {
    expect(getCoworkReservationIntervalInput("2099-06-10")).toEqual({
      startsAt: "2099-06-10T00:00",
      endsAt: "2099-06-11T00:00",
    });
  });

  test("represents cowork reservations by date without an interval", () => {
    const result = coworkReservationParser.safeParse({
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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        entryTier: "plus",
        date: "2099-06-10",
        coffee: true,
        message: "hello",
      });
      expect(result.success).not.toHaveProperty("startsAt");
      expect(result.success).not.toHaveProperty("endsAt");
    }
  });

  test("rejects monitor setup for non-profi cowork tiers", () => {
    const result = coworkReservationParser.safeParse({
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

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["monitorOption"]');
    }
  });

  test("requires a monitor setup for profi cowork reservations", () => {
    const result = coworkReservationParser.safeParse({
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

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["monitorOption"]');
    }
  });
});
