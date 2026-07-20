import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { discountIdSchema } from "@/features/discounts/contracts";
import { checkoutSummaryOrderItemSchema } from "./checkout-quote";

const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const discountId = Schema.decodeUnknownSync(discountIdSchema);
const decodeOrderItem = Schema.decodeUnknownSync(
  checkoutSummaryOrderItemSchema,
  { onExcessProperty: "error" }
);

const discount = {
  discount: {
    id: discountId("summer-sale"),
    label: "Summer sale",
    adjustment: { kind: "percentage" as const, basisPoints: 5000 },
  },
  amount: money(17_500),
};

describe("checkout summary schemas", () => {
  test("accepts a canonical discounted product item", () => {
    expect(
      decodeOrderItem({
        key: "product:cowork:basic",
        product: { kind: "cowork", tier: "basic" },
        originalAmount: money(35_000),
        amount: money(17_500),
        discounts: [discount],
      })
    ).toEqual({
      key: "product:cowork:basic",
      product: { kind: "cowork", tier: "basic" },
      originalAmount: money(35_000),
      amount: money(17_500),
      discounts: [discount],
    });
  });

  test("rejects partial discounted product shapes", () => {
    expect(() =>
      decodeOrderItem({
        key: "product:cowork:basic",
        product: { kind: "cowork", tier: "basic" },
        originalAmount: money(35_000),
        amount: money(17_500),
      })
    ).toThrow();

    expect(() =>
      decodeOrderItem({
        key: "product:cowork:basic",
        product: { kind: "cowork", tier: "basic" },
        amount: money(17_500),
        discounts: [discount],
      })
    ).toThrow();

    expect(() =>
      decodeOrderItem({
        key: "product:cowork:basic",
        product: { kind: "cowork", tier: "basic" },
        originalAmount: money(35_000),
        amount: money(17_500),
        discounts: [],
      })
    ).toThrow();
  });

  test("rejects a product key that disagrees with its identity", () => {
    expect(() =>
      decodeOrderItem({
        key: "product:cowork:plus",
        product: { kind: "cowork", tier: "basic" },
        amount: money(35_000),
      })
    ).toThrow();
  });

  test.each([
    ["providerKind", "calendar"],
    ["calendarEventId", "event-id"],
    ["dotyposGroupId", "group-id"],
    ["codeRecordId", "code-id"],
    ["submittedCode", "SUMMER50"],
  ] as const)("rejects provider-private inline field %s", (field, value) => {
    expect(() =>
      decodeOrderItem({
        key: "product:cowork:basic",
        product: { kind: "cowork", tier: "basic" },
        originalAmount: money(35_000),
        amount: money(17_500),
        discounts: [
          {
            ...discount,
            discount: {
              ...discount.discount,
              [field]: value,
            },
          },
        ],
      })
    ).toThrow();
  });
});
