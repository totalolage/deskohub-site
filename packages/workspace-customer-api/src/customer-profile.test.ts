import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import {
  CustomerProfileInput,
  CustomerProfileSave,
  customerInputParseOptions,
  customerProfileSchemas,
} from "./customer-profile";

const profileWithPhone = (phone: string) => ({ firstName: "Jana", phone });

const savedPhone = (schema: typeof CustomerProfileSave, phone: string) =>
  Schema.decodeOption(schema)(
    profileWithPhone(phone),
    customerInputParseOptions
  ).pipe(
    Option.map((save) => save.phone),
    Option.getOrNull
  );

const acceptsInput = (schema: typeof CustomerProfileInput, phone: string) =>
  Schema.is(schema)(profileWithPhone(phone));

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

describe("the customer API profile schemas", () => {
  test("read a phone without a country calling code as Czech", () => {
    expect(acceptsInput(CustomerProfileInput, "777 123 456")).toBe(true);
    expect(acceptsInput(CustomerProfileInput, "0151 23456789")).toBe(false);
    expect<string | null>(savedPhone(CustomerProfileSave, "777 123 456")).toBe(
      "+420777123456"
    );
  });
});
