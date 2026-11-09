import { describe, expect, test } from "bun:test";
import { Temporal } from "@js-temporal/polyfill";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { type Locale, locales } from "@/features/i18n";
import {
  type CustomerReservationSummary,
  completeCustomerProfileStandardSchema,
  groupCustomerReservations,
  updateCustomerProfileStandardSchema,
} from "./contracts";

const validateProfileInput = async (
  input: { readonly firstName: string; readonly phone?: string },
  locale: Locale = "cs-CZ"
) => updateCustomerProfileStandardSchema(locale)["~standard"].validate(input);

const validateCompletionInput = async (
  input: { readonly firstName: string; readonly phone?: string },
  locale: Locale
) => completeCustomerProfileStandardSchema(locale)["~standard"].validate(input);

const savedPhone = (
  outcome: StandardSchemaV1.Result<{ readonly phone?: string }>
) => {
  if (outcome.issues) throw new Error("Expected the phone to be accepted");
  return outcome.value.phone;
};

const now = Temporal.Instant.from("2026-09-03T12:00:00Z");

const reservation = (
  overrides: Partial<CustomerReservationSummary> = {}
): CustomerReservationSummary => ({
  id: "reservation-1",
  product: { kind: "meeting-room" },
  startsAt: "2026-09-03T14:00:00Z",
  endsAt: "2026-09-03T16:00:00Z",
  seats: 2,
  status: "confirmed",
  ...overrides,
});

describe("groupCustomerReservations", () => {
  test("groups an ongoing reservation as current until its exact end instant", () => {
    const groups = groupCustomerReservations(
      [
        reservation({ id: "later-today" }),
        reservation({
          id: "exact-end",
          startsAt: "2026-09-03T10:00:00Z",
          endsAt: "2026-09-03T12:00:00Z",
        }),
      ],
      now
    );

    expect(groups.current.map(({ id }) => id)).toEqual(["later-today"]);
    expect(groups.past.map(({ id }) => id)).toEqual(["exact-end"]);
    expect(groups.unavailable).toHaveLength(0);
  });

  test("groups a cancelled reservation as past even with a future end date", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "cancelled", status: "cancelled" })],
      now
    );

    expect(groups.current).toHaveLength(0);
    expect(groups.past.map(({ id }) => id)).toEqual(["cancelled"]);
  });

  test("groups a missing end date as unavailable", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "missing-end", endsAt: null })],
      now
    );

    expect(groups.unavailable.map(({ id }) => id)).toEqual(["missing-end"]);
    expect(groups.current).toHaveLength(0);
    expect(groups.past).toHaveLength(0);
  });

  test("groups an unparseable end date as unavailable instead of throwing", () => {
    const groups = groupCustomerReservations(
      [reservation({ id: "invalid-end", endsAt: "not-an-instant" })],
      now
    );

    expect(groups.unavailable.map(({ id }) => id)).toEqual(["invalid-end"]);
  });
});

describe("customer profile input", () => {
  test("rejects a nonblank phone without a phone number instead of silently clearing it", async () => {
    const outcome = await validateProfileInput({
      firstName: "Ada",
      phone: "call me maybe",
    });

    expect(outcome).toHaveProperty("issues");
    const issues = (outcome as { readonly issues: readonly unknown[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).toContain("phone");
  });

  test("treats a blank phone as clearing the field", async () => {
    const outcome = await validateProfileInput({
      firstName: "Ada",
      phone: "   ",
    });

    expect(outcome).toHaveProperty("value");
    expect(
      (outcome as { readonly value: { readonly phone?: string } }).value.phone
    ).toBe("");
  });

  test.each([
    ["a local", "601123456"],
    ["an international", "+420 601 123 456"],
    ["a labelled", "601 123 456 (mobile)"],
  ])("decodes %s phone format to its E.164 number", async (_, phone) => {
    const outcome = await validateProfileInput({ firstName: "Ada", phone });

    expect(outcome).toHaveProperty("value");
    expect(
      (outcome as { readonly value: { readonly phone: string } }).value.phone
    ).toBe("+420601123456");
  });

  test("rejects a phone longer than 32 characters", async () => {
    const outcome = await validateProfileInput({
      firstName: "Ada",
      phone: `601 123 456 ${"x".repeat(21)}`,
    });

    expect(outcome).toHaveProperty("issues");
  });
});

describe("customer profile phone in the visitor's locale", () => {
  const germanMobile = "0151 23456789";

  test.each([
    ["profile", validateProfileInput],
    ["completion", validateCompletionInput],
  ] as const)(
    "reads a %s phone without a country calling code in the locale's region",
    async (_, validate) => {
      for (const [locale, phone, saved] of [
        ["cs-CZ", "601 123 456", "+420601123456"],
        ["en-US", "601 123 456", "+420601123456"],
        ["de-DE", germanMobile, "+4915123456789"],
        ["uk-UA", "050 123 4567", "+380501234567"],
        ["sk-SK", "0905 123 456", "+421905123456"],
      ] as const) {
        expect(
          savedPhone(await validate({ firstName: "Ada", phone }, locale))
        ).toBe(saved);
      }
      expect(
        await validate({ firstName: "Ada", phone: germanMobile }, "cs-CZ")
      ).toHaveProperty("issues");
    }
  );

  test.each(locales)(
    "accepts a phone with a country calling code in %s",
    async (locale) => {
      expect(
        savedPhone(
          await validateProfileInput(
            { firstName: "Ada", phone: "+420 777 123 456" },
            locale
          )
        )
      ).toBe("+420777123456");
    }
  );
});
