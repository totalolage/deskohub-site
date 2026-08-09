import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { discountIdSchema } from "@/features/discounts/contracts";
import { checkoutSummaryOrderItemSchema } from "./checkout-summary";
import { checkoutSummaryProductItemBaseSchema } from "./checkout-summary-product-item";

const money = (value: number) => ({ value, exponent: 2, currency: "CZK" });
const discountId = Schema.decodeUnknownSync(discountIdSchema);
const decodeOrderItem = Schema.decodeUnknownSync(
  checkoutSummaryOrderItemSchema,
  { onExcessProperty: "error" }
);
const decodeFamilyNeutralProductItem = Schema.decodeUnknownSync(
  checkoutSummaryProductItemBaseSchema,
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

  test("requires the complete office identity in its product key", () => {
    const officeItem = {
      key: "product:office:3:2",
      product: { kind: "office", seats: 3, dayCount: 2 },
      dayCount: 2,
      seats: 3,
      accessAmount: money(106_000),
      seatAmount: money(63_000),
      amount: money(295_000),
    };

    expect(decodeOrderItem(officeItem)).toEqual(officeItem);
    expect(() =>
      decodeOrderItem({ ...officeItem, key: "product:office:2:2" })
    ).toThrow();
    expect(() =>
      decodeOrderItem({ ...officeItem, product: { kind: "office" } })
    ).toThrow();
  });

  test("keeps meeting-room presentation out of the family-neutral product item", () => {
    expect(() =>
      decodeFamilyNeutralProductItem({
        key: "product:meeting-room:day:1",
        product: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
        },
        meetingRoomDurationPresentation: "whole-day",
        amount: money(232_000),
      })
    ).toThrow();

    expect(() =>
      decodeOrderItem({
        key: "product:meeting-room:day:1",
        product: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
        },
        meetingRoomDurationPresentation: "whole-day",
        amount: money(232_000),
      })
    ).toThrow();

    expect(
      decodeOrderItem({
        key: "product:meeting-room:day:1",
        product: {
          kind: "meeting-room",
          duration: { unit: "day", amount: 1 },
        },
        amount: money(232_000),
      })
    ).not.toHaveProperty("meetingRoomDurationPresentation");
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
