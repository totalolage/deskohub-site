import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import { validateOrderDiscountCommitment } from "./order-discount-evidence";

const readRepository = () =>
  Bun.file(new URL("./order-discount-evidence.ts", import.meta.url)).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

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
    expect(issued).toContain("storedApplicationsMatchCommitment");
    expect(issued.indexOf("storedApplicationRows.length === 0")).toBeLessThan(
      issued.indexOf("persistOrderDiscountApplications")
    );
    expect(issued).toContain(
      'ownership: { kind: "issued_goods", issuedAt: input.issuedAt }'
    );
    expect(issued).not.toContain("releaseAttemptDiscountClaim");
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
