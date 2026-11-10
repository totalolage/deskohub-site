import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Result, Schema } from "effect";
import { defaultPhoneRegion, type Locale, locales } from "@/features/i18n";
import {
  normalizedReservationCustomerSchema,
  reservationCustomerSchema,
} from "./reservation-contact";

const customerWithPhone = (phone: string) => ({
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone,
});

const acceptsPhoneIn = (locale: Locale, phone: string) =>
  Result.isSuccess(
    Schema.decodeUnknownResult(
      reservationCustomerSchema(defaultPhoneRegion(locale))
    )(customerWithPhone(phone))
  );

describe("reservationCustomerSchema", () => {
  test("reads a German national number in de-DE but not in cs-CZ", () => {
    expect(acceptsPhoneIn("de-DE", "0151 23456789")).toBe(true);
    expect(acceptsPhoneIn("cs-CZ", "0151 23456789")).toBe(false);
  });

  test("reads a Ukrainian national number in uk-UA but not in cs-CZ", () => {
    expect(acceptsPhoneIn("uk-UA", "050 123 4567")).toBe(true);
    expect(acceptsPhoneIn("cs-CZ", "050 123 4567")).toBe(false);
  });

  test.each(locales)(
    "accepts a number with a country calling code in %s",
    (locale) => {
      expect(acceptsPhoneIn(locale, "+420 777 123 456")).toBe(true);
    }
  );

  test("reads a Czech national number in cs-CZ and en-US as before", () => {
    expect(acceptsPhoneIn("cs-CZ", "777 123 456")).toBe(true);
    expect(acceptsPhoneIn("en-US", "777 123 456")).toBe(true);
  });

  test("keeps the phone as the customer entered it, trimmed", () => {
    const decoded = Schema.decodeUnknownSync(
      reservationCustomerSchema(defaultPhoneRegion("de-DE"))
    )(customerWithPhone(" 0151 23456789 "));

    expect(decoded.phone).toBe("0151 23456789");
  });
});

describe("normalizedReservationCustomerSchema", () => {
  test("builds a reservation contact whose national number no region was named for", () => {
    const customer = normalizedReservationCustomerSchema.make(
      customerWithPhone("0151 23456789")
    );

    expect(customer.phone).toBe("0151 23456789");
  });

  test("still requires a phone", () => {
    expect(() =>
      normalizedReservationCustomerSchema.make(customerWithPhone(""))
    ).toThrow();
  });
});
