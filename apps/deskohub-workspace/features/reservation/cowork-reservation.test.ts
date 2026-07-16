import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import "@/shared/polyfills/temporal";
import { makeSchemaParser } from "@/shared/utils/schema-parser";
import {
  coworkReservationSchema as coworkReservationDefinition,
  coworkReservationOrderSchema as coworkReservationOrderDefinition,
  getCoworkReservationIntervalInput,
  getCoworkReservationOrder,
} from "./cowork-reservation";

const coworkReservationSchema = makeSchemaParser(coworkReservationDefinition);
const coworkReservationOrderSchema = makeSchemaParser(
  coworkReservationOrderDefinition
);

describe("cowork reservation schema", () => {
  test("owns the cowork full-day interval policy", () => {
    expect(getCoworkReservationIntervalInput("2099-06-10")).toEqual({
      startsAt: "2099-06-10T00:00",
      endsAt: "2099-06-11T00:00",
    });
  });

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

    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) {
      expect(result.success).toMatchObject({
        _tag: "cowork",
        entryTier: "plus",
        date: "2099-06-10",
        coffee: true,
        message: "hello",
      });
      expect(result.success).not.toHaveProperty("startsAt");
      expect(result.success).not.toHaveProperty("endsAt");
      expect(getCoworkReservationOrder(result.success)).not.toHaveProperty(
        "legalConsent"
      );
    }
  });

  test("decodes cowork orders with the domain discriminator", () => {
    const result = coworkReservationOrderSchema.safeParse({
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
      expect(result.success).not.toHaveProperty("_tag");
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

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["monitorOption"]');
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

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(String(result.failure)).toContain('at ["monitorOption"]');
    }
  });
});
