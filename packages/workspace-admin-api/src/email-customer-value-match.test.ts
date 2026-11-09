import { describe, expect, test } from "bun:test";
import type { EmailCustomerField } from "./email-customer-selection";
import { matchesEmailCustomerField } from "./email-customer-value-match";

const present = { nullable: false, optional: false };
const text: EmailCustomerField = { ...present, kind: "scalar", type: "string" };
const count: EmailCustomerField = {
  ...present,
  kind: "scalar",
  type: "number",
};

describe("matchesEmailCustomerField", () => {
  test("accepts a missing value only for an optional field and null only for a nullable one", () => {
    expect(matchesEmailCustomerField(undefined, text)).toBe(false);
    expect(
      matchesEmailCustomerField(undefined, { ...text, optional: true })
    ).toBe(true);
    expect(matchesEmailCustomerField(null, text)).toBe(false);
    expect(matchesEmailCustomerField(null, { ...text, nullable: true })).toBe(
      true
    );
  });

  test("matches a scalar by type and, when restricted, by choice", () => {
    const flag: EmailCustomerField = {
      ...present,
      kind: "scalar",
      type: "boolean",
    };
    const status: EmailCustomerField = { ...text, choices: ["paid", "failed"] };

    expect(matchesEmailCustomerField("any", text)).toBe(true);
    expect(matchesEmailCustomerField(1, text)).toBe(false);
    expect(matchesEmailCustomerField(false, flag)).toBe(true);
    expect(matchesEmailCustomerField("paid", status)).toBe(true);
    expect(matchesEmailCustomerField("pending", status)).toBe(false);
  });

  test("matches a union when any alternative matches", () => {
    const either: EmailCustomerField = {
      ...present,
      kind: "union",
      alternatives: [text, count],
    };

    expect(matchesEmailCustomerField(3, either)).toBe(true);
    expect(matchesEmailCustomerField(true, either)).toBe(false);
    expect(
      matchesEmailCustomerField("x", { ...either, alternatives: [] })
    ).toBe(false);
  });

  test("matches a list when it is an array of matching elements", () => {
    const counts: EmailCustomerField = {
      ...present,
      kind: "list",
      element: count,
    };

    expect(matchesEmailCustomerField([], counts)).toBe(true);
    expect(matchesEmailCustomerField([1, 2], counts)).toBe(true);
    expect(matchesEmailCustomerField([1, "2"], counts)).toBe(false);
    expect(matchesEmailCustomerField({ 0: 1 }, counts)).toBe(false);
  });

  test("matches a record with only declared fields, each matching or optionally absent", () => {
    const room: EmailCustomerField = {
      ...present,
      kind: "record",
      fields: { name: text, seats: { ...count, optional: true } },
    };

    expect(matchesEmailCustomerField({ name: "Atrium" }, room)).toBe(true);
    expect(matchesEmailCustomerField({ name: "Atrium", seats: 8 }, room)).toBe(
      true
    );
    expect(matchesEmailCustomerField({ seats: 8 }, room)).toBe(false);
    expect(matchesEmailCustomerField({ name: "Atrium", floor: 2 }, room)).toBe(
      false
    );
    expect(matchesEmailCustomerField(["Atrium"], room)).toBe(false);
    expect(matchesEmailCustomerField("Atrium", room)).toBe(false);
  });

  test("matches nothing but absence and null for an unsupported field", () => {
    const unsupported: EmailCustomerField = {
      nullable: true,
      optional: false,
      kind: "unsupported",
    };

    expect(matchesEmailCustomerField("x", unsupported)).toBe(false);
    expect(matchesEmailCustomerField({}, unsupported)).toBe(false);
    expect(matchesEmailCustomerField(null, unsupported)).toBe(true);
  });
});
