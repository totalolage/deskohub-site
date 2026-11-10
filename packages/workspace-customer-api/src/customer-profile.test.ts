import { describe, expect, test } from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { Option, Schema } from "effect";
import {
  accountPhoneRegion,
  accountProfileSchemas,
  CustomerProfileCompletionInput,
  CustomerProfileInput,
  customerInputParseOptions,
  customerProfileSchemas,
} from "./customer-profile";

const profileWithPhone = (phone: string) => ({ firstName: "Jana", phone });

type ProfileSchemas = ReturnType<typeof customerProfileSchemas>;

const savedPhone = (schema: ProfileSchemas["save"], phone: string) =>
  Schema.decodeOption(schema)(
    profileWithPhone(phone),
    customerInputParseOptions
  ).pipe(
    Option.map((save) => save.phone),
    Option.getOrNull
  );

const acceptsInput = (
  schema: ProfileSchemas["input"] | typeof CustomerProfileInput,
  phone: string
) => Schema.is(schema)(profileWithPhone(phone));

describe("customerProfileSchemas", () => {
  test.each([
    ["DE", "0151 23456789", "+4915123456789"],
    ["UA", "050 123 4567", "+380501234567"],
    ["CZ", "777 123 456", "+420777123456"],
  ] as const)(
    "reads a phone entered in %p without a country calling code",
    (region, entered, e164) => {
      const schemas = customerProfileSchemas(region);
      expect(acceptsInput(schemas.input, entered)).toBe(true);
      expect(acceptsInput(schemas.completionInput, entered)).toBe(true);
      expect<string | null>(savedPhone(schemas.save, entered)).toBe(e164);
      expect<string | null>(savedPhone(schemas.completionSave, entered)).toBe(
        e164
      );
    }
  );

  test("rejects a national number its default region does not allow", () => {
    const czech = customerProfileSchemas("CZ");
    expect(acceptsInput(czech.input, "0151 23456789")).toBe(false);
    expect(savedPhone(czech.save, "0151 23456789")).toBeNull();
  });

  test("accepts an international number in every region", () => {
    for (const region of ["CZ", "DE", "UA", "SK"]) {
      const schemas = customerProfileSchemas(region);
      expect(acceptsInput(schemas.input, "+420 777 123 456")).toBe(true);
      expect<string | null>(savedPhone(schemas.save, "+420 777 123 456")).toBe(
        "+420777123456"
      );
    }
  });

  test("keeps a blank phone as clearing it", () => {
    expect<string | null>(
      savedPhone(customerProfileSchemas("DE").save, "  ")
    ).toBe("");
  });
});

describe("the customer API profile input", () => {
  test("carries a phone a served locale's region reads, for the account's region to read", () => {
    for (const schema of [CustomerProfileInput, CustomerProfileCompletionInput])
      for (const entered of [
        "0151 23456789",
        "777 123 456",
        "050 123 4567",
        "0905 123 456",
        "+1 202 555 0143",
      ])
        expect(acceptsInput(schema, entered)).toBe(true);
  });

  test("refuses a phone without a phone number in any served region", () => {
    for (const schema of [CustomerProfileInput, CustomerProfileCompletionInput])
      expect(acceptsInput(schema, "call me maybe")).toBe(false);
  });
});

describe("accountProfileSchemas", () => {
  test("reads a phone in the phone region of the account's saved language", () => {
    for (const locale of supportedLocales)
      expect(accountPhoneRegion(locale)).toBe(
        getLocaleDefinition(locale).phoneRegion
      );
    expect<string | null>(
      savedPhone(accountProfileSchemas("de-DE").save, "0151 23456789")
    ).toBe("+4915123456789");
  });

  test("reads a phone as Czech for an account without a saved language", () => {
    const schemas = accountProfileSchemas(null);
    expect(acceptsInput(schemas.input, "777 123 456")).toBe(true);
    expect(acceptsInput(schemas.input, "0151 23456789")).toBe(false);
    expect<string | null>(savedPhone(schemas.save, "777 123 456")).toBe(
      "+420777123456"
    );
  });

  test("reads a phone as Czech for a language this build doesn't serve", () => {
    expect(accountPhoneRegion("xx-XX")).toBe(accountPhoneRegion(null));
  });
});
