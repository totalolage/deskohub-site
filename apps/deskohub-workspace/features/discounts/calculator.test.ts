import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { calculateDiscounts } from "./calculator";
import {
  type Discount,
  type DiscountProductIdentity,
  discountIdSchema,
} from "./contracts";
import type { DiscountCandidate } from "./provider";

const product = {
  kind: "cowork",
  tier: "basic",
} satisfies DiscountProductIdentity;

const discountId = Schema.decodeUnknownSync(discountIdSchema);

const money = (
  value: number,
  currency = "CZK",
  exponent = 2
): WorkspaceMoney => ({ value, currency, exponent });

const candidate = (
  discount: Discount,
  input: Partial<DiscountCandidate> = {}
): DiscountCandidate => ({
  discount,
  provenance: {
    providerNamespace: "private-provider",
    providerReference: `private-${discount.id}`,
  },
  ...input,
});

const percentage = (id: string, basisPoints: number): DiscountCandidate =>
  candidate({
    id: discountId(id),
    label: id,
    adjustment: { kind: "percentage", basisPoints },
  });

const fixed = (
  id: string,
  amount: WorkspaceMoney,
  input: Partial<DiscountCandidate> = {}
): DiscountCandidate =>
  candidate(
    {
      id: discountId(id),
      label: id,
      adjustment: { kind: "fixed", amount },
    },
    input
  );

const calculate = (
  discountableSubtotal: WorkspaceMoney,
  candidates: readonly DiscountCandidate[]
) =>
  Effect.runSync(
    calculateDiscounts({ product, discountableSubtotal, candidates })
  );

const calculateError = (
  discountableSubtotal: WorkspaceMoney,
  candidates: readonly DiscountCandidate[]
) =>
  Effect.runSync(
    Effect.flip(
      calculateDiscounts({ product, discountableSubtotal, candidates })
    )
  );

describe("discount calculator", () => {
  test("returns a zero total discount when no candidates apply", () => {
    expect(calculate(money(35_000), []).quote).toEqual({
      product,
      discountableSubtotal: money(35_000),
      discounts: [],
      totalDiscount: money(0),
      discountedSubtotal: money(35_000),
    });
  });

  test("accepts a valid zero-exponent subtotal", () => {
    expect(
      calculate(money(350, "CZK", 0), []).quote.discountableSubtotal
    ).toEqual(money(350, "CZK", 0));
  });

  test("applies percentages in integer basis points with minor-unit rounding", () => {
    const result = calculate(money(35_000), [percentage("sale", 1250)]);

    expect(result.quote.discounts[0]).toEqual({
      discount: {
        id: "sale",
        label: "sale",
        adjustment: { kind: "percentage", basisPoints: 1250 },
      },
      subtotalBefore: money(35_000),
      amount: money(4375),
      subtotalAfter: money(30_625),
    });
    expect(result.quote.totalDiscount).toEqual(money(4375));
    expect(result.quote.discountedSubtotal).toEqual(money(30_625));
  });

  test("rounds each percentage against the remaining subtotal", () => {
    const result = calculate(money(10_001), [
      percentage("first", 5000),
      percentage("second", 5000),
    ]);

    expect(result.quote.discounts.map(({ amount }) => amount.value)).toEqual([
      5001, 2500,
    ]);
    expect(result.quote.discountedSubtotal.value).toBe(2500);
  });

  test("rounds percentage adjustments exactly for large safe integers", () => {
    const result = calculate(money(7_603_566_542_929_820), [
      percentage("large", 2925),
    ]);

    expect(result.quote.discounts[0]?.amount.value).toBe(2_224_043_213_806_972);
  });

  test("preserves caller order while stacking sales, customer, and code", () => {
    const result = calculate(money(10_000), [
      percentage("calendar-b", 1000),
      percentage("calendar-c", 2000),
      percentage("customer", 500),
      fixed("code", money(1000)),
    ]);

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "calendar-b",
      "calendar-c",
      "customer",
      "code",
    ]);
    expect(result.quote.discounts.map(({ amount }) => amount.value)).toEqual([
      1000, 1800, 360, 1000,
    ]);
    expect(result.quote.discountedSubtotal.value).toBe(5840);
  });

  test("clamps fixed adjustments to the remaining subtotal", () => {
    const result = calculate(money(1200), [fixed("large", money(5000))]);

    expect(result.quote.discounts[0]?.amount).toEqual(money(1200));
    expect(result.quote.discountedSubtotal).toEqual(money(0));
    expect(result.quote.totalDiscount).toEqual(money(1200));
  });

  test("stops after a full discount and creates no later code application", () => {
    const result = calculate(money(5000), [
      percentage("full-sale", 10_000),
      fixed("submitted-code", money(-1, "EUR"), {
        claim: {
          kind: "discount_code",
          codeId: "private-code-id",
          dotyposCustomerId: "private-customer-id",
        },
      }),
    ]);

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "full-sale",
    ]);
    expect(result.applications).toHaveLength(1);
    expect(result.quote.discountedSubtotal).toEqual(money(0));
  });

  test("omits rounded-zero applications while continuing the sequence", () => {
    const result = calculate(money(1), [
      candidate(
        {
          id: "rounded-zero-code",
          label: "rounded-zero-code",
          adjustment: { kind: "percentage", basisPoints: 1 },
        },
        {
          claim: {
            kind: "discount_code",
            codeId: "rounded-zero-code-id",
            dotyposCustomerId: "customer-id",
          },
        }
      ),
      fixed("fixed", money(1)),
    ]);

    expect(result.quote.discounts.map(({ discount }) => discount.id)).toEqual([
      "fixed",
    ]);
    expect(result.quote.totalDiscount).toEqual(money(1));
    expect(result.applications).toHaveLength(1);
    expect(result.applications[0]?.candidate.claim).toBeUndefined();
  });

  test("retains private claim instructions only for applied candidates", () => {
    const result = calculate(money(1000), [
      fixed("code", money(100), {
        claim: {
          kind: "discount_code",
          codeId: "private-code-id",
          dotyposCustomerId: "private-customer-id",
        },
      }),
    ]);

    expect(result.applications[0]?.candidate.claim).toEqual({
      kind: "discount_code",
      codeId: "private-code-id",
      dotyposCustomerId: "private-customer-id",
    });
  });

  test("preserves expiry and countdown metadata in application snapshots", () => {
    const result = calculate(money(1000), [
      candidate({
        id: "timed",
        label: "Timed discount",
        adjustment: { kind: "percentage", basisPoints: 1000 },
        expiresAt: "2026-08-02T22:00:00.000Z",
        countdownStartsAt: "2026-08-01T22:00:00.000Z",
      }),
    ]);

    expect(result.quote.discounts[0]?.discount).toEqual({
      id: "timed",
      label: "Timed discount",
      adjustment: { kind: "percentage", basisPoints: 1000 },
      expiresAt: "2026-08-02T22:00:00.000Z",
      countdownStartsAt: "2026-08-01T22:00:00.000Z",
    });
  });

  test("discounts only cowork subtotal and leaves paid Basic coffee outside", () => {
    const result = calculate(money(35_000), [percentage("half", 5000)]);
    const completeOrderTotal =
      result.quote.discountedSubtotal.value + money(5000).value;

    expect(completeOrderTotal).toBe(22_500);
  });

  test("rejects invalid discountable subtotal money", () => {
    for (const invalidSubtotal of [
      money(-1),
      money(1.5),
      money(Number.MAX_SAFE_INTEGER + 1),
      money(100, "czk"),
      money(100, "CZK", -1),
      money(100, "CZK", Number.MAX_SAFE_INTEGER + 1),
    ]) {
      const error = calculateError(invalidSubtotal, []);

      expect(error.reason).toBe("invalid_discountable_subtotal");
      expect(error.cause).toBeDefined();
    }
  });

  test("rejects invalid percentage adjustments", () => {
    for (const basisPoints of [0, -1, 1.5, 10_001]) {
      const error = calculateError(money(1000), [
        percentage("invalid", basisPoints),
      ]);

      expect(error.reason).toBe("invalid_percentage_adjustment");
      expect(error.discountId).toBe("invalid");
    }
  });

  test("rejects non-positive and non-integer fixed adjustments", () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        calculateError(money(1000), [fixed("invalid", money(value))]).reason
      ).toBe("invalid_fixed_adjustment");
    }
  });

  test("distinguishes fixed currency and exponent mismatches", () => {
    expect(
      calculateError(money(1000), [fixed("currency", money(100, "EUR"))]).reason
    ).toBe("currency_mismatch");
    expect(
      calculateError(money(1000), [fixed("exponent", money(100, "CZK", 0))])
        .reason
    ).toBe("exponent_mismatch");
  });

  test("keeps private provider and claim data out of the public quote", () => {
    const discountWithRuntimeProviderFields = {
      id: "opaque-public-id",
      label: "opaque-public-id",
      adjustment: {
        kind: "fixed",
        amount: {
          ...money(100),
          providerAmountReference: "private-amount-reference",
        },
        source: "private-adjustment-source",
      },
      source: "private-discount-source",
      calendarEventId: "private-calendar-event-id",
      discountGroupId: "private-group-id",
      codeId: "private-code-id-on-discount",
    } as unknown as Discount;
    const result = Effect.runSync(
      calculateDiscounts({
        product: {
          ...product,
          source: "private-product-source",
        } as DiscountProductIdentity,
        discountableSubtotal: {
          ...money(1000),
          source: "private-subtotal-source",
        } as WorkspaceMoney,
        candidates: [
          candidate(discountWithRuntimeProviderFields, {
            provenance: {
              providerNamespace: "calendar-provider",
              providerReference: "calendar-event-id",
              details: { discountGroupId: "private-group" },
            },
            claim: {
              kind: "discount_code",
              codeId: "private-code-id",
              dotyposCustomerId: "private-customer-id",
            },
          }),
        ],
      })
    );
    const serializedQuote = JSON.stringify(result.quote);

    expect(serializedQuote).not.toContain("calendar-provider");
    expect(serializedQuote).not.toContain("calendar-event-id");
    expect(serializedQuote).not.toContain("private-group");
    expect(serializedQuote).not.toContain("private-code-id");
    expect(serializedQuote).not.toContain("private-customer-id");
    expect(serializedQuote).not.toContain("private-discount-source");
    expect(serializedQuote).not.toContain("private-adjustment-source");
    expect(serializedQuote).not.toContain("private-amount-reference");
    expect(serializedQuote).not.toContain("private-calendar-event-id");
    expect(serializedQuote).not.toContain("private-product-source");
    expect(serializedQuote).not.toContain("private-subtotal-source");
  });
});
