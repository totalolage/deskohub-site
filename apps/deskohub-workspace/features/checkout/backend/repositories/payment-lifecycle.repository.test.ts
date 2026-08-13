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

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("PaymentLifecycleRepository", () => {
  test("owns attempt, reservation, applications, and claim admission in one transaction", async () => {
    const source = await readRepository();
    const createPendingNexiAttempt = sliceFrom(
      source,
      "const createPendingNexiAttempt = Effect.fn(",
      "      const completeInternalPayment"
    );

    expect(createPendingNexiAttempt).toContain(".transaction");
    expect(createPendingNexiAttempt).toContain('.for("update")');
    expect(createPendingNexiAttempt).toContain(".insert(paymentAttempts)");
    expect(createPendingNexiAttempt).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(createPendingNexiAttempt).toContain(
      ".update(workspaceReservations)"
    );
    expect(createPendingNexiAttempt).toContain(
      "yield* persistDiscountApplications"
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
      createPendingNexiAttempt.indexOf("yield* persistDiscountApplications")
    );
    expect(
      createPendingNexiAttempt.indexOf("yield* persistDiscountApplications")
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
    expect(completeInternalPayment).toContain(
      "persistAccountingDocumentSnapshot"
    );
    expect(completeInternalPayment).toContain(".update(workspaceReservations)");
    expect(completeInternalPayment).toContain(
      "yield* persistDiscountApplications"
    );
    expect(completeInternalPayment).toContain(
      "yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain("yield* redeemCodeClaim");
    expect(
      completeInternalPayment.indexOf("Temporal.Now.instant()")
    ).toBeGreaterThan(completeInternalPayment.indexOf('.for("update")'));
    expect(
      completeInternalPayment.indexOf("yield* reserveCommittedCodeClaim")
    ).toBeLessThan(completeInternalPayment.indexOf("yield* redeemCodeClaim"));
  });

  test("uses the admitted claim timestamp for immediate internal redemption", async () => {
    const source = await readRepository();
    const completeInternalPayment = sliceFrom(
      source,
      "const completeInternalPayment = Effect.fn(",
      "      const attachProviderSession"
    );
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain("return claimedAt");
    expect(completeInternalPayment).toContain(
      "const claimedAt = yield* reserveCommittedCodeClaim"
    );
    expect(completeInternalPayment).toContain(
      "yield* redeemCodeClaim(tx, attemptRow.id, claimedAt)"
    );
    expect(completeInternalPayment).not.toContain(
      "yield* redeemCodeClaim(tx, attemptRow.id, paidAt)"
    );
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
    const source = await readRepository();
    const reserveClaim = sliceFrom(
      source,
      'const reserveCodeClaim = Effect.fn("PaymentLifecycle.reserveCodeClaim")',
      'const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")'
    );

    expect(reserveClaim).toContain(".from(discountCodes)");
    expect(reserveClaim).toContain('.for("update")');
    expect(reserveClaim).not.toContain(".update(discountCodeRedemptions)");
    expect(reserveClaim).not.toContain(
      'releaseReason: "reservation_expired_before_reuse"'
    );
    expect(reserveClaim.indexOf("Temporal.Now.instant()")).toBeGreaterThan(
      reserveClaim.lastIndexOf('.for("update")')
    );
    expect(reserveClaim).toContain(
      "Temporal.Instant.compare(input.reservationExpiresAt, claimedAt)"
    );
    expect(reserveClaim).toContain("getDiscountCodeTiming(code.validUntil)");
    expect(reserveClaim).toContain(
      "currentDefinition.labels[input.locale] !=="
    );
    expect(reserveClaim).toContain("discountProductTargets.productTarget");
    expect(reserveClaim).toContain(
      "getWorkspaceProductTarget(input.claim.product)"
    );
    expect(reserveClaim).not.toContain(
      "eq(discountProductTargets.productTarget, input.claim.product)"
    );
    expect(reserveClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(reserveClaim).toContain("code.maxUsesPerCustomer !== null");
    expect(reserveClaim).toContain("customerUses?.count");
    expect(reserveClaim).not.toContain('"already_redeemed"');
    expect(reserveClaim).toContain(".insert(discountCodeRedemptions)");
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
    expect(paid).toContain("yield* redeemCodeClaim");
    expect(terminal).toContain("db.transaction");
    expect(terminal).toContain("yield* releaseCodeClaim");
    expect(terminal).not.toContain(".delete(accountingDocumentSnapshots)");
    expect(terminal).not.toContain(
      'input.failureCode !== "payment_abandoned_after_provider_cutoff"'
    );
  });

  test("rechecks released claim capacity before late-payment redemption", async () => {
    const source = await readRepository();
    const redeemClaim = sliceFrom(
      source,
      'const redeemCodeClaim = Effect.fn("PaymentLifecycle.redeemCodeClaim")',
      "const releaseCodeClaim"
    );

    expect(redeemClaim).toContain(".from(discountCodes)");
    expect(redeemClaim).toContain('.for("update")');
    expect(redeemClaim).toContain("discountCodeRedemptions.dotyposCustomerId");
    expect(redeemClaim).toContain(
      'inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])'
    );
    expect(redeemClaim).toContain('reason: "usage_limit_reached"');
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
