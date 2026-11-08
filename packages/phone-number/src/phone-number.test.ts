import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { parsePhoneNumberWithError } from "libphonenumber-js";
import {
  isPhoneNumber,
  PhoneNumberSchema,
  parsePhoneNumber,
  phoneNumberParts,
} from "./phone-number";

/**
 * Entered text, the E.164 number parsePhoneNumber reads from it (null for
 * none), and whether isPhoneNumber accepts the whole text.
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

describe("parsePhoneNumber", () => {
  test.each(enteredPhones)("reads %p as %p", (text, expected) => {
    expect<string | null>(Option.getOrNull(parsePhoneNumber(text))).toBe(
      expected
    );
  });
});

describe("isPhoneNumber", () => {
  test.each(enteredPhones)("checks the whole of %p", (text, _, expected) => {
    expect(isPhoneNumber(text)).toBe(expected);
  });

  test("accepts only text parsePhoneNumber also reads", () => {
    for (const [text] of enteredPhones) {
      if (isPhoneNumber(text)) {
        expect(Option.isSome(parsePhoneNumber(text))).toBe(true);
      }
    }
  });
});

describe("PhoneNumberSchema", () => {
  const decode = Schema.decodeUnknownOption(PhoneNumberSchema);

  test.each(enteredPhones)("decodes %p as %p", (text, expected) => {
    expect<string | null>(Option.getOrNull(decode(text))).toBe(expected);
  });

  test("reports an invalid phone number", () => {
    expect(() => Schema.decodeSync(PhoneNumberSchema)("abc")).toThrow(
      "Invalid phone number"
    );
  });

  test("encodes a phone number as its E.164 text, which decodes to itself", () => {
    const phone = Option.getOrThrow(parsePhoneNumber("777 123 456"));
    const encoded = Schema.encodeSync(PhoneNumberSchema)(phone);
    expect(encoded).toBe("+420777123456");
    expect(Schema.decodeSync(PhoneNumberSchema)(encoded)).toBe(phone);
  });

  test("holds only a valid number in E.164 form", () => {
    const isPhoneNumberValue = Schema.is(PhoneNumberSchema);
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
        phoneNumberParts(Option.getOrThrow(parsePhoneNumber(text)))
      ).toEqual({
        countryCallingCode: entered.countryCallingCode,
        nationalNumber: entered.nationalNumber,
      });
    }
  );

  test("splits a Czech number", () => {
    expect(
      phoneNumberParts(Option.getOrThrow(parsePhoneNumber("777 123 456")))
    ).toEqual({ countryCallingCode: "420", nationalNumber: "777123456" });
  });
});
