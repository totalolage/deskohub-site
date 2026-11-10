import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import {
  formatPhoneNumber,
  isPhoneNumber,
  isPhoneRegion,
  parsePhoneNumber,
  phoneNumberParts,
  phoneNumberSchema,
} from "./phone-number";

/**
 * Entered text, the E.164 number parsePhoneNumber reads from it in the Czech
 * default region (null for none), and whether isPhoneNumber accepts the whole
 * text.
 */
const enteredPhones = [
  ["777123456", "+420777123456", true],
  ["  777 123 456  ", "+420777123456", true],
  ["+420 777 123 456", "+420777123456", true],
  ["+420-777-123-456", "+420777123456", true],
  ["777.123.456", "+420777123456", true],
  ["777/123/456", "+420777123456", true],
  ["(777) 123 456", "+420777123456", true],
  ["00420777123456", "+420777123456", true],
  ["777123456 ext. 12", "+420777123456", true],
  ["+44 20 7946 0123", "+442079460123", true],
  ["+1 202 555 0143", "+12025550143", true],
  ["777 123 456 (mobile)", "+420777123456", false],
  ["tel. 777123456", "+420777123456", false],
  ["777123456;", "+420777123456", false],
  ["202 555 0143", null, false],
  ["+420 123 456 789", null, false],
  ["777 123 4567", null, false],
  ["++420777123456", null, false],
  ["+420777123456 / +420777123457", null, false],
  ["not a phone", null, false],
  ["", null, false],
  ["   ", null, false],
] as const;

/**
 * Text entered without a country calling code, the default region it is
 * entered in, and the E.164 number that region reads from it.
 */
const nationalPhones = [
  ["0151 23456789", "DE", "+4915123456789"],
  ["030 12345678", "DE", "+493012345678"],
  ["050 123 4567", "UA", "+380501234567"],
  ["0905 123 456", "SK", "+421905123456"],
  ["777 123 456", "CZ", "+420777123456"],
] as const;

const internationalPhones = [
  ["+420 777 123 456", "+420777123456"],
  ["+49 151 23456789", "+4915123456789"],
  ["+380 50 123 4567", "+380501234567"],
] as const;

const regions = ["CZ", "DE", "UA", "SK", "US", "VN", "IN"] as const;

describe("the default region", () => {
  test.each(nationalPhones)(
    "reads %p entered in %p as %p",
    (text, region, e164) => {
      expect<string | null>(
        Option.getOrNull(parsePhoneNumber(text, region))
      ).toBe(e164);
      expect(isPhoneNumber(text, region)).toBe(true);
    }
  );

  test.each(nationalPhones.filter(([, region]) => region !== "CZ"))(
    "does not read %p as a Czech number",
    (text) => {
      expect(Option.getOrNull(parsePhoneNumber(text, "CZ"))).toBeNull();
      expect(isPhoneNumber(text, "CZ")).toBe(false);
    }
  );

  test("reads a Czech national number as German in Germany", () => {
    expect<string | null>(
      Option.getOrNull(parsePhoneNumber("777 123 456", "DE"))
    ).toBe("+49777123456");
  });

  test.each(internationalPhones)(
    "reads %p as %p in every region",
    (text, e164) => {
      for (const region of regions) {
        expect<string | null>(
          Option.getOrNull(parsePhoneNumber(text, region))
        ).toBe(e164);
        expect(isPhoneNumber(text, region)).toBe(true);
      }
    }
  );

  test("reads only international numbers in a region without a numbering plan", () => {
    expect(Option.getOrNull(parsePhoneNumber("777 123 456", "XX"))).toBeNull();
    expect(isPhoneNumber("777 123 456", "XX")).toBe(false);
    expect<string | null>(
      Option.getOrNull(parsePhoneNumber("+420777123456", "XX"))
    ).toBe("+420777123456");
    expect(isPhoneNumber("+420777123456", "XX")).toBe(true);
  });

  test("names the regions that have a numbering plan", () => {
    for (const region of regions) {
      expect(isPhoneRegion(region)).toBe(true);
    }
    for (const region of ["XX", "cz", "", "CZE"]) {
      expect(isPhoneRegion(region)).toBe(false);
    }
  });

  test("decodes entered text in its region", () => {
    for (const [text, region, e164] of nationalPhones) {
      expect<string | null>(
        Option.getOrNull(Schema.decodeOption(phoneNumberSchema(region))(text))
      ).toBe(e164);
    }
  });
});

describe("parsePhoneNumber", () => {
  test.each(enteredPhones)("reads %p as %p", (text, expected) => {
    expect<string | null>(Option.getOrNull(parsePhoneNumber(text, "CZ"))).toBe(
      expected
    );
  });
});

describe("isPhoneNumber", () => {
  test.each(enteredPhones)("checks the whole of %p", (text, _, expected) => {
    expect(isPhoneNumber(text, "CZ")).toBe(expected);
  });

  test("accepts only text parsePhoneNumber also reads", () => {
    for (const [text] of enteredPhones) {
      if (isPhoneNumber(text, "CZ")) {
        expect(Option.isSome(parsePhoneNumber(text, "CZ"))).toBe(true);
      }
    }
  });
});

describe("phoneNumberSchema", () => {
  const czechPhoneNumberSchema = phoneNumberSchema("CZ");
  const decode = Schema.decodeUnknownOption(czechPhoneNumberSchema);

  test.each(enteredPhones)("decodes %p as %p", (text, expected) => {
    expect<string | null>(Option.getOrNull(decode(text))).toBe(expected);
  });

  test("reports an invalid phone number", () => {
    expect(() => Schema.decodeSync(czechPhoneNumberSchema)("abc")).toThrow(
      "Invalid phone number"
    );
  });

  test("encodes a phone number as its E.164 text, which decodes to itself", () => {
    const phone = Option.getOrThrow(parsePhoneNumber("777 123 456", "CZ"));
    const encoded = Schema.encodeSync(czechPhoneNumberSchema)(phone);
    expect(encoded).toBe("+420777123456");
    expect(Schema.decodeSync(czechPhoneNumberSchema)(encoded)).toBe(phone);
  });

  test("holds only a valid number in E.164 form", () => {
    const isPhoneNumberValue = Schema.is(czechPhoneNumberSchema);
    expect(isPhoneNumberValue("+420777123456")).toBe(true);
    for (const value of ["777123456", "+420 777 123 456", "+420123456789"]) {
      expect(isPhoneNumberValue(value)).toBe(false);
    }
  });
});

describe("phoneNumberParts", () => {
  test.each(enteredPhones.filter(([, , whole]) => whole))(
    "splits %p as its entered text parses",
    (text) => {
      const entered = parsePhoneNumberWithError(text, "CZ");
      expect(
        phoneNumberParts(Option.getOrThrow(parsePhoneNumber(text, "CZ")))
      ).toEqual({
        countryCallingCode: entered.countryCallingCode,
        nationalNumber: entered.nationalNumber,
      });
    }
  );

  test("splits a Czech number", () => {
    expect(
      phoneNumberParts(Option.getOrThrow(parsePhoneNumber("777 123 456", "CZ")))
    ).toEqual({ countryCallingCode: "420", nationalNumber: "777123456" });
  });
});

describe("formatPhoneNumber", () => {
  test.each(enteredPhones.filter(([, e164]) => e164 !== null))(
    "writes the number %p holds in international format",
    (text, e164) => {
      expect(
        formatPhoneNumber(Option.getOrThrow(parsePhoneNumber(text, "CZ")))
      ).toBe(parsePhoneNumberWithError(e164 ?? "").formatInternational());
    }
  );

  test("reads back as the same number", () => {
    const phone = Option.getOrThrow(parsePhoneNumber("777123456", "CZ"));
    expect(parsePhoneNumber(formatPhoneNumber(phone), "CZ")).toEqual(
      Option.some(phone)
    );
  });
});
