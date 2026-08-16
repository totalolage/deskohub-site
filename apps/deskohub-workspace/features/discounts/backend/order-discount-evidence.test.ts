import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { calculateGoodsBasketDiscounts } from "@/features/discounts/basket-calculator";
import {
  getDiscountCommitmentPayload,
  getGoodsBasketDiscountCommitmentPayload,
  makeDiscountCommitment,
  makeGoodsBasketDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { voucherIdSchema } from "@/features/discounts/persistence-contracts";
import { workspaceGoodsProductIdentitySchema } from "@/features/goods";
import {
  validateIssuedGoodsBasketDiscountCommitment,
  validateOrderDiscountCommitment,
} from "./order-discount-evidence";

const readRepository = () =>
  Bun.file(new URL("./order-discount-evidence.ts", import.meta.url)).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});
const categoryId = DotyposCategoryIdSchema.make("category-a");
const products = ["product-a", "product-b"].map((productId) =>
  workspaceGoodsProductIdentitySchema.make({
    kind: "goods",
    categoryId,
    productId: DotyposProductIdSchema.make(productId),
  })
);

const makeBasket = async (input: { readonly voucher?: boolean } = {}) => {
  const discount = {
    id: Schema.decodeUnknownSync(discountIdSchema)("basket-discount"),
    label: "Basket discount",
    adjustment: { kind: "fixed" as const, amount: money(150) },
  };
  const calculation = await Effect.runPromise(
    calculateGoodsBasketDiscounts({
      lines: [
        { product: products[0]!, discountableSubtotal: money(100) },
        { product: products[1]!, discountableSubtotal: money(200) },
      ],
      candidates: [
        {
          candidate: {
            discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "basket-discount",
            },
            ...(input.voucher && {
              claim: {
                kind: "voucher" as const,
                voucherId: voucherIdSchema.make("voucher-1"),
                availableAmount: money(150),
                dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
              },
            }),
          },
          eligibleLineIndexes: [0, 1],
        },
      ],
    })
  );
  return getGoodsBasketDiscountCommitmentPayload(
    makeGoodsBasketDiscountCommitment({
      quote: calculation.quote,
      applications: calculation.applications,
    })
  );
};

const issuedLines = (payable = [50, 100]) =>
  products.map((productIdentity, sequence) => ({
    sequence,
    productIdentity,
    undiscountedTotalValue: sequence === 0 ? 100 : 200,
    payableTotalValue: payable[sequence]!,
    amountExponent: 2,
    currency: "CZK",
  }));

describe("order discount evidence", () => {
  test("rejects inconsistent committed money in the shared policy", async () => {
    const discountId = Schema.decodeUnknownSync(discountIdSchema)("discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: { value: 35_000, exponent: 2, currency: "CZK" },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: { value: 27_999, exponent: 2, currency: "CZK" },
    };
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "test",
            },
          },
        },
      ],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateOrderDiscountCommitment(
          getDiscountCommitmentPayload(commitment)
        )
      )
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "DiscountClaimError",
        operation: "reserve",
        reason: "money_mismatch",
      },
    });
  });

  test("issues goods evidence once under the order and line locks", async () => {
    const source = await readRepository();
    const issued = sliceFrom(
      source,
      "export const persistIssuedGoodsDiscountEvidence",
      "export const admitOrderDiscountClaim"
    );

    expect(issued).toContain("eq(orders.id, input.orderId)");
    expect(issued).toContain('.for("update")');
    expect(issued.indexOf(".from(orders)")).toBeLessThan(
      issued.indexOf(".from(orderLines)")
    );
    expect(issued).toContain('order.kind !== "goods"');
    expect(issued).toContain("storedApplicationsMatchEvidence");
    expect(issued.indexOf("storedApplicationRows.length === 0")).toBeLessThan(
      issued.indexOf("persistDiscountApplicationRows")
    );
    expect(issued).toContain(
      'ownership: { kind: "issued_goods", issuedAt: input.issuedAt }'
    );
    expect(issued).toContain("applicationId: null");
    expect(issued).not.toContain("releaseAttemptDiscountClaim");
  });

  test("validates every positive allocation and the full basket totals", async () => {
    const validated = await Effect.runPromise(
      validateIssuedGoodsBasketDiscountCommitment({
        commitment: await makeBasket(),
        lines: issuedLines(),
      })
    );

    expect(
      validated.applications.map(({ application }) => application.amount.value)
    ).toEqual([50, 100]);
    expect(validated.claimedApplication).toBeUndefined();
  });

  test("records one voucher claim for the full multi-line allocation", async () => {
    const validated = await Effect.runPromise(
      validateIssuedGoodsBasketDiscountCommitment({
        commitment: await makeBasket({ voucher: true }),
        lines: issuedLines(),
      })
    );

    expect(validated.claimedApplication).toMatchObject({
      appliedAmount: money(150),
      claim: { kind: "voucher", voucherId: "voucher-1" },
    });
    expect(validated.claimedApplication?.products).toEqual(products);
  });

  test("rejects product, line-chain, and aggregate money mismatches", async () => {
    const commitment = await makeBasket({ voucher: true });
    const wrongProduct = issuedLines();
    wrongProduct[1] = { ...wrongProduct[1]!, productIdentity: products[0]! };

    for (const lines of [wrongProduct, issuedLines([50, 101])]) {
      const result = await Effect.runPromise(
        Effect.result(
          validateIssuedGoodsBasketDiscountCommitment({ commitment, lines })
        )
      );
      expect(result._tag).toBe("Failure");
    }
  });

  test("direct issuance creates only permanently redeemed attemptless claims", async () => {
    const source = await readRepository();
    const admission = sliceFrom(
      source,
      "export const admitOrderDiscountClaim",
      "const repairAttemptEvidenceOrder"
    );

    expect(admission).toContain(
      'input.ownership.kind === "reservation_attempt"'
    );
    expect(admission).toContain('? ("reserved" as const)');
    expect(admission).toContain(': ("redeemed" as const)');
    expect(admission).toContain("paymentAttemptId:");
    expect(admission).toContain("reservationExpiresAt:");
    expect(admission).toContain("redeemedAt:");
    expect(admission).toContain("validateStoredDiscountClaim");
    expect(admission).toContain("validateVoucherClaim");
    expect(admission).toContain("appliedAmountValue:");
  });

  test("attempt transitions repair mixed-version ownership before changing claims", async () => {
    const source = await readRepository();
    const repair = sliceFrom(
      source,
      "const repairAttemptEvidenceOrder",
      "export const redeemAttemptDiscountClaim"
    );
    const redeem = sliceFrom(
      source,
      "export const redeemAttemptDiscountClaim",
      "export const releaseAttemptDiscountClaim"
    );
    const release = sliceFrom(
      source,
      "export const releaseAttemptDiscountClaim",
      "const claimError"
    );

    expect(
      repair.match(/\.set\(\{ orderId: input\.orderId \}\)/g)
    ).toHaveLength(3);
    expect(redeem.indexOf("repairAttemptEvidenceOrder")).toBeLessThan(
      redeem.indexOf(".from(discountCodeRedemptions)")
    );
    expect(release.indexOf("repairAttemptEvidenceOrder")).toBeLessThan(
      release.indexOf(".from(discountCodeRedemptions)")
    );
    expect(redeem).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(release).toContain('eq(discountCodeRedemptions.state, "reserved")');
  });

  test("does not persist or log customer PII in generic evidence", async () => {
    const source = await readRepository();

    expect(source).not.toMatch(/customer(?:Email|Name|AccessCode)/);
    expect(source).not.toContain("rawPayload");
    expect(source).not.toContain("annotateLogs");
    expect(source).not.toContain("Effect.log");
  });
});
