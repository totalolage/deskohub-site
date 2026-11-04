import { describe, expect, test } from "bun:test";
import type { EmailCustomerField } from "./email-customer-selection";
import { emailValueMatchesField } from "./email-value-snapshot";

const presence = { nullable: false, optional: false };
const contact: EmailCustomerField = {
  kind: "record",
  fields: {
    displayName: { kind: "scalar", type: "string", ...presence },
    phone: { kind: "scalar", type: "string", nullable: true, optional: true },
  },
  ...presence,
};

describe("emailValueMatchesField", () => {
  test("accepts a record with its required fields and optional ones absent", () => {
    expect(emailValueMatchesField({ displayName: "Jana" }, contact)).toBe(true);
    expect(
      emailValueMatchesField({ displayName: "Jana", phone: null }, contact)
    ).toBe(true);
  });

  test("rejects a scalar of the wrong type", () => {
    expect(
      emailValueMatchesField(42, {
        kind: "scalar",
        type: "string",
        ...presence,
      })
    ).toBe(false);
    expect(emailValueMatchesField({ displayName: 42 }, contact)).toBe(false);
  });

  test("rejects a record without a required field", () => {
    expect(emailValueMatchesField({ phone: "123" }, contact)).toBe(false);
  });
});
