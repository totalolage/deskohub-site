import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  getDiscountCommitmentPayload,
  makeDiscountCommitment,
} from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  validateDiscountCommitment,
  validateInternalPaymentCommitment,
} from "./payment-lifecycle.repository";

const readRepository = () =>
  Bun.file(
    new URL("./payment-lifecycle.repository.ts", import.meta.url)
  ).text();

const readDiscountEvidence = () =>
  Bun.file(
    new URL(
      "../../../discounts/backend/order-discount-evidence.ts",
      import.meta.url
    )
  ).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, order, reservation, applications, and claim admission in one transaction", async () => {
    const source = await readRepository();
    const createPendingNexiAttempt = sliceFrom(
      source,
      "const createPendingNexiAttempt = Effect.fn(",
      "      const completeInternalPayment"
    );

    expect(createPendingNexiAttempt).toContain(".transaction");
    expect(createPendingNexiAttempt).toContain('.for("update")');
    expect(createPendingNexiAttempt).toContain(".insert(paymentAttempts)");
    expect(createPendingNexiAttempt).toContain(".update(orders)");
    expect(createPendingNexiAttempt).toContain("orderId: input.orderId");
    expect(createPendingNexiAttempt).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(createPendingNexiAttempt).toContain(
      ".update(workspaceReservations)"
    );
    expect(createPendingNexiAttempt).toContain(
      "yield* persistOrderDiscountApplications"
    );
    expect(createPendingNexiAttempt).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(
      createPendingNexiAttempt.indexOf("Temporal.Now.instant()")
    ).toBeGreaterThan(createPendingNexiAttempt.indexOf('.for("update")'));
    expect(
      createPendingNexiAttempt.indexOf(".insert(paymentAttempts)")
    ).toBeLessThan(
      createPendingNexiAttempt.indexOf(
        "yield* persistOrderDiscountApplications"
      )
    );
    expect(
      createPendingNexiAttempt.indexOf(
        "yield* persistOrderDiscountApplications"
      )
    ).toBeLessThan(
      createPendingNexiAttempt.indexOf("yield* reserveCommittedCodeClaim")
    );
  });

  test("atomically completes an internal payment with applications and immediate claim redemption", async () => {
    const source = await readRepository();
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );

    expect(completeInternalPayment).toContain(".transaction");
    expect(completeInternalPayment).toContain('.for("update")');
    expect(completeInternalPayment).toContain('provider: "internal"');
    expect(completeInternalPayment).toContain('state: "paid"');
    expect(completeInternalPayment).toContain(".insert(paymentAttempts)");
    expect(completeInternalPayment).toContain(".update(orders)");
    expect(completeInternalPayment).toContain("orderId: input.orderId");
    expect(completeInternalPayment).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(completeInternalPayment).toContain(".update(workspaceReservations)");
    expect(completeInternalPayment).toContain(
      "yield* persistOrderDiscountApplications"
    );
    expect(completeInternalPayment).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain(
      "yield* redeemAttemptDiscountClaim"
    );
    expect(
      completeInternalPayment.indexOf("Temporal.Now.instant()")
    ).toBeGreaterThan(completeInternalPayment.indexOf('.for("update")'));
    expect(
      completeInternalPayment.indexOf("yield* reserveCommittedCodeClaim")
    ).toBeLessThan(
      completeInternalPayment.indexOf("yield* redeemAttemptDiscountClaim")
    );
  });

  test("uses the admitted claim timestamp for immediate internal redemption", async () => {
    const source = await readRepository();
    const evidence = await readDiscountEvidence();
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );
    const reserveClaim = sliceFrom(
      evidence,
      "export const admitOrderDiscountClaim",
      "const repairAttemptEvidenceOrder"
    );

    expect(reserveClaim).toContain("return claimedAt");
    expect(completeInternalPayment).toContain(
      "const claimedAt = yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain("redeemedAt: claimedAt");
    expect(completeInternalPayment).not.toContain("redeemedAt: paidAt");
  });

  test("sets the provider order creation timestamp when the Nexi session attaches", async () => {
    const source = await readRepository();
    const attachProviderSession = sliceFrom(
      source,
      "const attachProviderSession = Effect.fn(",
      "      const markPaid"
    );
    expect(attachProviderSession).toContain(
      "const providerOrderCreatedAt = Temporal.Now.instant()"
    );
    expect(attachProviderSession).toContain("providerOrderCreatedAt,");
    expect(attachProviderSession).toContain(
      "updatedAt: providerOrderCreatedAt"
    );
  });

  test("locks the code and leaves claim release to owning terminal transitions", async () => {
    const source = await readDiscountEvidence();
    const reserveClaim = sliceFrom(
      source,
      "export const admitOrderDiscountClaim",
      "const repairAttemptEvidenceOrder"
    );

    expect(reserveClaim).toContain(".from(discountCodes)");
    expect(reserveClaim).toContain('.for("update")');
    expect(reserveClaim).not.toContain(".update(discountCodeRedemptions)");
    expect(reserveClaim).not.toContain(
      'releaseReason: "reservation_expired_before_reuse"'
    );
    expect(reserveClaim.indexOf("Temporal.Now.instant()")).toBeGreaterThan(
      reserveClaim.indexOf('.for("update")')
    );
    expect(reserveClaim).toContain("input.ownership.reservationExpiresAt");
    expect(reserveClaim).toContain(
      "getPromotionTiming(input.promotion.validUntil)"
    );
    expect(reserveClaim).toContain(
      "currentDefinition.labels[input.locale] !=="
    );
    expect(reserveClaim).toContain("discountProductTargets.productTarget");
    expect(reserveClaim).toContain("workspaceProductTargetMatches(");
    expect(reserveClaim).not.toContain(
      "eq(discountProductTargets.productTarget, input.claim.product)"
    );
    expect(reserveClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(reserveClaim).toContain("code.maxUsesPerCustomer !== null");
    expect(reserveClaim).toContain("customerUses?.count");
    expect(reserveClaim).not.toContain('"already_redeemed"');
    expect(reserveClaim).toContain("validateVoucherClaim");
    expect(reserveClaim).toContain("coalesce(sum(");
    expect(reserveClaim).toContain("discountApplications.appliedAmountValue");
    expect(reserveClaim.indexOf("validateVoucherClaim")).toBeLessThan(
      reserveClaim.indexOf(".insert(discountCodeRedemptions)")
    );
    expect(reserveClaim).toContain(".insert(discountCodeRedemptions)");
    expect(reserveClaim).toContain(".insert(voucherRedemptions)");
  });

  test("redeems and releases claims inside the owning paid and terminal transactions", async () => {
    const source = await readRepository();
    const paid = sliceFrom(
      source,
      'const markPaid = Effect.fn("PaymentLifecycleRepository.markPaid")',
      "      const markTerminal"
    );
    const terminal = sliceFrom(
      source,
      'const markTerminal = Effect.fn("PaymentLifecycleRepository.markTerminal")',
      "      return {\n        createPendingNexiAttempt,"
    );

    expect(paid).toContain("db.transaction");
    expect(paid).toContain("yield* mirrorPaidReservation");
    expect(paid).toContain("yield* redeemAttemptDiscountClaim({");
    expect(terminal).toContain("db.transaction");
    expect(terminal).toContain("yield* mirrorTerminalReservation");
    expect(terminal).toContain("yield* releaseAttemptDiscountClaim({");
    expect(source).toContain('Match.when("goods", () => Effect.void)');
    expect(source).toContain("yield* redeemAttemptDiscountClaim({");
    expect(source).toContain("yield* releaseAttemptDiscountClaim({");
    expect(terminal).not.toContain(".delete(accountingDocumentSnapshots)");
    expect(terminal).not.toContain(
      'input.failureCode !== "payment_abandoned_after_provider_cutoff"'
    );
  });

  test("repairs release-skew reservation attempts before paid and terminal writes", async () => {
    const source = await readRepository();
    const lockAndRepair = sliceFrom(
      source,
      "const lockOrderForPaymentTransition = Effect.fn(",
      "const mirrorPaidReservation"
    );
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );

    expect(lockAndRepair).toContain("isNull(paymentAttempts.orderId)");
    expect(lockAndRepair).toContain("paymentAttempts.workspaceReservationId");
    expect(lockAndRepair).toContain("yield* ensureReservationOrder");
    expect(lockAndRepair).toContain(".set({ orderId: input.orderId })");
    expect(lockAndRepair.indexOf("yield* ensureReservationOrder")).toBeLessThan(
      lockAndRepair.indexOf(".set({ orderId: input.orderId })")
    );
    expect(completeInternalPayment).toContain(
      "yield* lockOrderForPaymentTransition"
    );
  });

  test("uses the persisted terminal timestamp when repairing an idempotent retry", async () => {
    const source = await readRepository();
    const terminal = sliceFrom(
      source,
      'const markTerminal = Effect.fn("PaymentLifecycleRepository.markTerminal")',
      "      return {\n        createPendingNexiAttempt,"
    );

    expect(terminal).toContain("terminalAt: consistent.updatedAt");
    expect(terminal).toContain("releasedAt: consistent.updatedAt");
  });

  test("rechecks released claim capacity before late-payment redemption", async () => {
    const source = await readDiscountEvidence();
    const redeemClaim = sliceFrom(
      source,
      "export const redeemAttemptDiscountClaim",
      "export const releaseAttemptDiscountClaim"
    );

    expect(redeemClaim).toContain(".from(discountCodes)");
    expect(redeemClaim).toContain('.for("update")');
    expect(redeemClaim).toContain("discountCodeRedemptions.dotyposCustomerId");
    expect(redeemClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(redeemClaim).toContain('reason: "usage_limit_reached"');
    expect(redeemClaim).toContain(".from(vouchers)");
    expect(redeemClaim).toContain("voucher.issuedAmountValue -");
    expect(redeemClaim).toContain(".update(voucherRedemptions)");
  });

  test("matches promotion claim variants explicitly", async () => {
    const source = await readRepository();

    expect(source).not.toContain('claim?.kind === "discount_code" ?');
    expect(source).not.toContain('yield* input.claim.kind === "discount_code"');
    expect(source).not.toContain('yield* stored.kind === "discount_code"');
    expect(source).not.toContain('yield* claim.kind === "discount"');
  });

  test("rejects inconsistent committed money before opening a transaction", async () => {
    const discountId =
      Schema.decodeUnknownSync(discountIdSchema)("public-discount");
    const application = {
      discount: {
        id: discountId,
        label: "Test discount",
        adjustment: { kind: "percentage" as const, basisPoints: 2000 },
      },
      subtotalBefore: {
        value: 35_000,
        exponent: 2,
        currency: "CZK",
      },
      amount: { value: 7000, exponent: 2, currency: "CZK" },
      subtotalAfter: {
        value: 27_999,
        exponent: 2,
        currency: "CZK",
      },
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
        validateDiscountCommitment(getDiscountCommitmentPayload(commitment))
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

  test("rejects an internal payment without a full-discount commitment", async () => {
    const commitment = makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [],
    });

    const result = await Effect.runPromise(
      Effect.result(
        validateInternalPaymentCommitment(
          getDiscountCommitmentPayload(commitment),
          {
            value: 0,
            exponent: 2,
            currency: "CZK",
          }
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
});
