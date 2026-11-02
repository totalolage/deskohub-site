import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import type { EmailCustomerField } from "./email-customer-selection";
import { emailValueSnapshotForDefinition } from "./email-value-snapshot";
import { EmailValueDefinition } from "./emails";

const locale = "cs-CZ";
const definitionOf = (input: object) =>
  Schema.decodeUnknownSync(EmailValueDefinition)({ name: "value", ...input });
const accepts = (definition: EmailValueDefinition, snapshot: unknown) =>
  Schema.is(emailValueSnapshotForDefinition(definition, locale))(snapshot);
const resolved = (value: unknown) => ({ _tag: "Resolved", value });

const reservations = definitionOf({
  source: {
    kind: "customer",
    path: ["activity", "reservations"],
    fields: [["type"], ["statusNote"]],
    limit: 2,
  },
  fallback: { [locale]: "No reservations" },
});
const reservation = (type: string) => ({ type, statusNote: null });

describe("emailValueSnapshotForDefinition", () => {
  test("accepts the locale's configured fallback text only", () => {
    expect(
      accepts(reservations, { _tag: "Fallback", text: "No reservations" })
    ).toBe(true);
    expect(accepts(reservations, { _tag: "Fallback", text: "Other" })).toBe(
      false
    );
    expect(
      accepts(definitionOf({ source: reservations.source }), {
        _tag: "Fallback",
        text: "No reservations",
      })
    ).toBe(false);
  });

  test("accepts a list of selected records up to the selection limit", () => {
    expect(accepts(reservations, resolved([]))).toBe(true);
    expect(
      accepts(
        reservations,
        resolved([reservation("cowork"), reservation("office")])
      )
    ).toBe(true);
    expect(
      accepts(
        reservations,
        resolved([
          reservation("cowork"),
          reservation("office"),
          reservation("meeting-room"),
        ])
      )
    ).toBe(false);
    expect(accepts(reservations, resolved(null))).toBe(false);
  });

  test("rejects values outside the selected shape", () => {
    expect(accepts(reservations, resolved([reservation("garage")]))).toBe(
      false
    );
    expect(
      accepts(
        reservations,
        resolved([{ ...reservation("cowork"), createdAt: "2026-11-02" }])
      )
    ).toBe(false);
    expect(accepts(reservations, resolved([{ statusNote: "late" }]))).toBe(
      false
    );
    expect(accepts(reservations, resolved([["cowork"]]))).toBe(false);
    expect(accepts(reservations, resolved({ type: "cowork" }))).toBe(false);
  });

  test("checks values against the frozen shape when it still matches the catalogue", () => {
    const selection = {
      kind: "customer",
      path: ["profile", "customer", "email"],
    } as const;
    const current = definitionOf({ source: selection });
    const frozen = definitionOf({
      source: selection,
      customerShape: {
        kind: "scalar",
        type: "string",
        nullable: false,
        optional: false,
      } satisfies EmailCustomerField,
    });

    expect(accepts(current, resolved(testEmailAddress("customer")))).toBe(true);
    expect(accepts(frozen, resolved(testEmailAddress("customer")))).toBe(false);
  });

  test("rejects every value of a customer source that left the catalogue", () => {
    const removed = definitionOf({
      source: { kind: "customer", path: ["profile", "removed"] },
      fallback: { [locale]: "Unknown" },
    });

    expect(accepts(removed, resolved("anything"))).toBe(false);
    expect(accepts(removed, { _tag: "Fallback", text: "Unknown" })).toBe(false);
  });

  test("accepts a discount only as a non-empty code with a parseable expiry", () => {
    const discount = definitionOf({
      source: {
        kind: "discount",
        discountId: "01900000-0000-7000-8000-000000000001",
        validDays: 30,
      },
    });
    const expiresAt = "2026-12-02T00:00:00.000Z";

    expect(accepts(discount, resolved({ code: "WELCOME", expiresAt }))).toBe(
      true
    );
    for (const value of [
      { code: "", expiresAt },
      { code: "WELCOME", expiresAt: "soon" },
      { code: "WELCOME", expiresAt: 1 },
      { code: 1, expiresAt },
      { code: "WELCOME" },
      { code: "WELCOME", expiresAt, extra: true },
      ["WELCOME", expiresAt],
      "WELCOME",
    ]) {
      expect(accepts(discount, resolved(value))).toBe(false);
    }
  });
});
